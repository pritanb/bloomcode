import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { LocalApi, ApiError } from './local-api.js';
import { goalChange, confirmedGoalChange } from '../shared/learning-goals.js';
import { preferenceChange, confirmedPreferenceChange } from '../shared/tutor-preferences.js';
import { confirmedPlanChange } from '../shared/plan-changes.js';
import { noteChange, confirmedNoteChange } from '../shared/tutor-notes.js';
import { confirmedStudyListChange } from '../shared/study-list.js';
import { neetcodeCategories } from '../server/topics/neetcode-category.js';
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
const version = z.number().int().nonnegative();
const key = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const date = z.iso.date();
const action = z.enum(['recommended', 'manual', 'none']);
const schemas = {
  get_tutor_access: z.strictObject({}),
  get_tutor_preferences: z.strictObject({}),
  propose_tutor_preferences: z.strictObject({ change: preferenceChange }),
  confirm_tutor_preferences: confirmedPreferenceChange.extend({ idempotencyKey: key }),
  get_learning_goals: z.strictObject({
    state: z.enum(['active', 'completed', 'abandoned', 'all']).optional(),
  }),
  propose_learning_goal: z.strictObject({ change: goalChange }),
  confirm_learning_goal: confirmedGoalChange.extend({ idempotencyKey: key }),
  get_tutor_notes: z.strictObject({ topic: z.string().trim().min(1).max(60).optional() }),
  propose_tutor_note: z.strictObject({ change: noteChange }),
  confirm_tutor_note: confirmedNoteChange.extend({ idempotencyKey: key }),
  get_today_plan: z.strictObject({}),
  get_training_levels: z.strictObject({}),
  get_shortlist: z.strictObject({ topic: z.string().trim().min(1).max(100).optional() }),
  propose_plan_change: z.strictObject({
    mode: z.enum(['add', 'replace']).optional(),
    items: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1).max(200),
          reason: z.string().trim().min(1).max(500),
          requested: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  confirm_plan_change: confirmedPlanChange.extend({ idempotencyKey: key }),
  get_study_list: z.strictObject({}),
  propose_study_list: z.strictObject({
    planSource: z.enum(['list', 'bloom']),
    set: z.string().trim().min(1).max(100).optional(),
    from: z.string().trim().min(1).max(200).optional(),
    problems: z.array(z.string().trim().min(1).max(300)).min(1).max(500).optional(),
    name: z.string().trim().min(1).max(100).optional(),
  }),
  confirm_study_list: confirmedStudyListChange.extend({ idempotencyKey: key }),
  get_topic_scores: z.strictObject({ limit: z.number().int().min(1).max(50).optional() }),
  get_recent_attempts: z.strictObject({
    startedAfter: z.iso.datetime({ offset: true }).optional(),
    problem: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  get_learning_insights: z.strictObject({}),
  retrieve_learning_evidence: z.strictObject({
    query: z.string().trim().min(1).max(800),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  get_today: z.strictObject({ date: date.optional() }),
  search_questions: z.strictObject({
    search: z.string().max(200).optional(),
    status: z
      .enum([
        'all',
        'solved',
        'not_solved',
        'stopped',
        'not_submitted',
        'unsolved',
        'completed',
        'attempted',
      ])
      .optional(),
    tags: z.array(id).max(20).optional(),
    tagMode: z.enum(['any', 'all']).optional(),
    listId: id.optional(),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
    timeBucket: z.enum(['0-10', '10-20', '20-30', '30-45', '45+', 'unknown']).optional(),
    sort: z.enum(['title', 'lastAttempt', 'solveTime', 'reviewDate']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().min(1).max(10000).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  get_attempt_context: z.strictObject({ attemptId: id }),
  finish_attempt: z.strictObject({
    attemptId: id,
    idempotencyKey: key,
    version,
    outcome: z.enum(['solved', 'not_solved', 'stopped']),
    help: z.enum(['none', 'small', 'major', 'solution', 'unknown']),
    activeSeconds: z.number().int().nonnegative().nullable(),
    code: z.string().max(200000).optional(),
    notes: z.string().max(50000).optional(),
    confidence: z.number().min(1).max(5).nullable().optional(),
    reviewDate: date.nullable().optional(),
    reviewAction: action.optional(),
  }),
  save_review: z.strictObject({
    attemptId: id,
    idempotencyKey: key,
    version,
    feedback: z.string().min(1).max(50000),
    decisions: z
      .array(
        z.strictObject({
          topicId: id,
          expectedVersion: version,
          oldScore: z.number().min(1).max(5),
          newScore: z.number().min(1).max(5),
          rationale: z.string().min(1).max(10000),
          evidence: z.enum(['retention', 'near_transfer', 'unseen', 'mock']),
        }),
      )
      .max(50)
      .optional(),
    followUp: z.strictObject({ date: date.nullable(), action }).optional(),
  }),
  set_review_date: z.strictObject({
    targetId: id,
    version,
    action: z.enum(['manual', 'snooze', 'none', 'recommended']),
    date: date.nullable().optional(),
  }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  get_tutor_access: 'Check whether tutoring is permitted; no study records are returned.',
  get_tutor_preferences:
    'Read the current explanation depth, hint style and version. A null sourceConversation means defaults, not learner-confirmed preferences.',
  propose_tutor_preferences:
    'Propose explicit teaching preferences for host confirmation; does not save. Include BOTH current-or-requested values and the current version. Preserve any preference the learner did not ask to change. Depth: concise, balanced, detailed. Hint style: questions, progressive hints, or direct guidance. Do not infer preferences from learner performance.',
  confirm_tutor_preferences:
    'Host-only: save preferences AFTER explicit confirmation using the full credential. Retry uncertain writes with the SAME key and payload.',
  get_learning_goals:
    'Read up to 20 saved learning goals (active by default). Includes versions and source conversation. Hidden during mixed assessments.',
  propose_learning_goal:
    'Propose a goal or state change for the learner to review. This does NOT save anything. The host will ask for explicit confirmation. Never claim a proposal is saved. For state changes use the current goal ID and version.',
  confirm_learning_goal:
    'Host-only: commit a change AFTER explicit learner confirmation. Requires full host credential; unavailable to the conversational tutor. Retry uncertain writes with the SAME idempotency key and payload.',
  get_tutor_notes:
    "Read lessons the learner confirmed about your tutoring, with IDs and versions. Each is general (topic null) or for one training topic. Without topic, returns every lesson while they fit the prompt budget, otherwise general lessons plus today's plan topics, with hasMore. With topic, returns only that topic's lessons. Hidden during mixed assessments.",
  propose_tutor_note:
    "Propose a lesson about your tutoring for the learner to confirm; does not save. Only from the learner's own feedback on your teaching or recommendations (a correction or praise), never inferred from their performance. One sentence written as a rule for your future self, with the example that prompted it. topic is a training topic name (e.g. Tries) or null for a general lesson. If a saved lesson covers the same point, use action 'update' with its ID, current version and exact current text as oldText. Use 'retire' when the learner asks you to forget one.",
  confirm_tutor_note:
    'Host-only: save a lesson change AFTER explicit learner confirmation, using the full credential. Retry uncertain writes with the SAME key and payload.',
  get_training_levels:
    "Read the learner's per-topic training level on the problem-rating scale (Elo-like; contest ratings, estimates marked), their target rating, which topics are at target, and the last change with its result (strong, ok or struggled). Hidden during mixed assessments.",
  get_shortlist:
    'Read what fits the learner now: for each topic below target (weakest first), unseen problems near their level with ratings and popularity, plus ideas due for a check (repair after a struggle, or a transfer check served as a different problem). Optional topic narrows it. Each due check has serveAs: the different problem to propose for it (null if none fits today). Recommend ONLY candidates and serveAs problems from this list; propose_plan_change refuses others unless the learner named them. Hidden during mixed assessments.',
  get_today_plan:
    "Read today's plan without creating it: items in order with status, reason and whether each is started, plus the learner's questions-per-day setting. Null plan means none generated yet. Hidden during mixed assessments.",
  propose_plan_change:
    "Propose problems for today's plan by exact library title, each with a one-sentence reason addressed to the learner. mode 'add' (default) appends; 'replace' swaps every unstarted item for these picks, keeping started and finished work. Up to ten items. Set requested: true only on a problem the learner named themselves; it may be off the shortlist (done before, above their level). Your own picks must come from get_shortlist. This does NOT change anything; the host asks the learner to confirm. Unmatched titles return close library titles instead of a proposal. Problems already on the plan are reported, not proposed again (in replace mode, unstarted ones stay proposed so they are kept).",
  confirm_plan_change:
    'Host-only: apply a confirmed plan change AFTER explicit learner confirmation, using the full credential. Retry uncertain writes with the SAME key and payload.',
  get_study_list:
    "Read who plans the learner's days (planSource bloom or list), their study list's name and progress (next titles, counts finished and not yet in the library), and the courses bundled with the app with their sections.",
  propose_study_list:
    "Propose who plans the learner's days, for the learner to confirm; does not save. planSource 'list' with set (a bundled course id from get_study_list, optionally from a section name or a slug in it) or problems (in order, each a LeetCode link, slug or exact title, as the learner gave them; with a name) replaces their study list; 'list' alone resumes the saved list; 'bloom' hands planning back to you and keeps the list and its progress. While the list plans, each day starts with its next unfinished problems (including ones solved before) and you fill the rest. Confirming re-plans today's unstarted questions.",
  confirm_study_list:
    'Host-only: apply a confirmed study-list change AFTER explicit learner confirmation, using the full credential. Retry uncertain writes with the SAME key and payload.',
  get_topic_scores:
    'Read topic scores, lowest scored topics first and unscored topics last. Limit 1–50 (default 20). Includes provisional flags, coverage counts and hasMore; null scores mean unknown, not weak. No notes or attempt history. Hidden during mixed assessments.',
  get_recent_attempts:
    'Find completed attempts newest first, optionally filtered by problem title substring. Returns IDs, titles, dates, outcomes and help usage. Use returned IDs with get_attempt_context; do not ask the learner to look up IDs. Limit 1–20 (default 10); hasMore indicates older matches. Optional startedAfter is an ISO timestamp (inclusive) for practice begun since a goal was agreed. Hidden during mixed assessments.',
  get_learning_insights:
    'Read the current learning report and coverage. Hidden during mixed assessments.',
  retrieve_learning_evidence:
    'Retrieve at most 20 current learning observations using local semantic and keyword search. Hidden during mixed assessments.',
  get_today:
    'Get or resume the stable daily plan; does not start an attempt. No hidden pattern context.',
  search_questions:
    'Search at most 100 questions. Metadata can reveal patterns: use only with consent, never to peek at an active mixed assessment.',
  get_attempt_context:
    'Read saved code, history and score versions for a requested review. Backend blocks active mixed assessment disclosure.',
  finish_attempt:
    'Finalise a reported attempt using its current version and a caller-chosen unique idempotency key. Retry with the SAME key and identical payload after uncertainty. Topic scores move automatically under conservative evidence rules. ALWAYS follow a successful finish with save_review in the same turn: the learner reads that note in the app as the summary of this attempt. Reads back the saved attempt.',
  save_review:
    'Record the tutor note shown against a finished attempt, and optionally adjust topic scores. Write one for EVERY finished attempt, straight after finish_attempt, as immediate feedback the learner can act on: what went well, what was missed, and what to practise next. Scores already move automatically when an attempt is finished, so omit "decisions" to leave a note without changing any score; supply them only to override that judgement. Supply the current attempt/topic versions and a stable idempotency key. Repeat evidence cannot justify increases above 3. Reads back context.',
  set_review_date:
    'Set a manual, snoozed, recommended or no-review schedule using its current version; reads back the target. On conflict re-read, do not blindly overwrite.',
};
export const toolDefinitions = Object.entries(schemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof schemas],
  inputSchema: z.toJSONSchema(schema) as { type: 'object' },
  annotations: {
    readOnlyHint: [
      'get_tutor_preferences',
      'propose_tutor_preferences',
      'get_learning_goals',
      'propose_learning_goal',
      'get_tutor_notes',
      'propose_tutor_note',
      'get_today_plan',
      'get_training_levels',
      'get_shortlist',
      'propose_plan_change',
      'get_study_list',
      'propose_study_list',
      'get_topic_scores',
      'get_tutor_access',
      'get_recent_attempts',
      'search_questions',
      'get_attempt_context',
      'get_learning_insights',
      'retrieve_learning_evidence',
    ].includes(name),
    destructiveHint: false,
    openWorldHint: false,
  },
}));
type StudyListView = {
  planSource: 'bloom' | 'list';
  name: string | null;
  slugs: string[];
  remaining: string[];
  finished: string[];
  notInLibrary: string[];
};
export async function callTool(api: LocalApi, name: string, args: unknown) {
  try {
    let result: unknown;
    if (name === 'get_tutor_access') {
      schemas.get_tutor_access.parse(args);
      result = await api.request('GET', '/api/tutor-access');
    } else if (name === 'get_tutor_preferences') {
      schemas.get_tutor_preferences.parse(args);
      result = await api.request('GET', '/api/tutor-preferences');
    } else if (name === 'propose_tutor_preferences') {
      result = { proposal: schemas.propose_tutor_preferences.parse(args).change, saved: false };
    } else if (name === 'confirm_tutor_preferences') {
      const { idempotencyKey, ...body } = schemas.confirm_tutor_preferences.parse(args);
      result = await api.request('POST', '/api/tutor-preferences', body, idempotencyKey);
    } else if (name === 'get_learning_goals') {
      const { state = 'active' } = schemas.get_learning_goals.parse(args);
      result = await api.request('GET', `/api/learning-goals?state=${state}`);
    } else if (name === 'propose_learning_goal') {
      result = { proposal: schemas.propose_learning_goal.parse(args).change, saved: false };
    } else if (name === 'confirm_learning_goal') {
      const { idempotencyKey, ...body } = schemas.confirm_learning_goal.parse(args);
      result = await api.request('POST', '/api/learning-goals', body, idempotencyKey);
    } else if (name === 'get_tutor_notes') {
      const { topic } = schemas.get_tutor_notes.parse(args);
      result = await api.request(
        'GET',
        `/api/tutor-notes${topic ? `?${new URLSearchParams({ topic })}` : ''}`,
      );
    } else if (name === 'propose_tutor_note') {
      const { change } = schemas.propose_tutor_note.parse(args);
      if ('topic' in change && change.topic !== null && !neetcodeCategories.includes(change.topic))
        throw new ApiError(
          'UNKNOWN_TOPIC',
          `Use a training topic or null. Topics: ${neetcodeCategories.join(', ')}`,
        );
      result = { proposal: change, saved: false };
    } else if (name === 'confirm_tutor_note') {
      const { idempotencyKey, ...body } = schemas.confirm_tutor_note.parse(args);
      result = await api.request('POST', '/api/tutor-notes', body, idempotencyKey);
    } else if (name === 'get_training_levels') {
      schemas.get_training_levels.parse(args);
      result = await api.request('GET', '/api/training-levels');
    } else if (name === 'get_shortlist') {
      const { topic } = schemas.get_shortlist.parse(args);
      result = await api.request(
        'GET',
        `/api/recommendations/shortlist${topic ? `?${new URLSearchParams({ topic })}` : ''}`,
      );
    } else if (name === 'get_today_plan') {
      schemas.get_today_plan.parse(args);
      result = await api.request('GET', '/api/daily-plan/today');
    } else if (name === 'propose_plan_change') {
      const { mode = 'add', items } = schemas.propose_plan_change.parse(args);
      const params = new URLSearchParams(items.map((i) => ['title', i.title]));
      const { results } = (await api.request('GET', `/api/daily-plan/lookup?${params}`)) as {
        results: {
          requested: string;
          problemId: string | null;
          title?: string;
          onPlan?: boolean;
          started?: boolean;
          onShortlist?: boolean;
          attempted?: boolean;
          reviewOf?: string | null;
          candidates?: string[];
        }[];
      };
      const unmatched = results.filter((r) => !r.problemId);
      // The tutor's own picks must come from the shortlist, which fits the learner's level;
      // problems the learner named are theirs to choose. Problems already on today's plan
      // are skipped or kept below, never refused.
      const offList = results.filter((r) => r.problemId && !r.onShortlist && !r.onPlan);
      const unfit = offList.filter((r) => !items[results.indexOf(r)]!.requested);
      // Replacing keeps unstarted picks only if they stay in the proposal.
      const skip = (r: (typeof results)[number]) => (mode === 'add' ? r.onPlan : r.started);
      const alreadyOnPlan = results.filter(skip).map((r) => r.title!);
      const seen = new Set<string>();
      const proposed = items.flatMap((item, i) => {
        const r = results[i]!;
        if (!r.problemId || skip(r) || seen.has(r.problemId)) return [];
        seen.add(r.problemId);
        // A served due check carries the idea it checks, so finishing it moves that schedule on.
        return [
          {
            problemId: r.problemId,
            title: r.title!,
            reason: item.reason,
            ...(r.reviewOf ? { reviewOf: r.reviewOf } : {}),
          },
        ];
      });
      const outsideShortlist = offList.map((r) => ({ title: r.title!, attempted: !!r.attempted }));
      result = unfit.length
        ? {
            saved: false,
            notOnShortlist: unfit.map((r) => r.title),
            note: "No proposal was made. These don't fit the learner's current training levels or were done recently. Choose from get_shortlist, or set requested only for problems the learner named.",
          }
        : unmatched.length
          ? {
              saved: false,
              unmatched: unmatched.map((r) => ({ title: r.requested, closest: r.candidates })),
              note: 'No proposal was made. Use exact library titles or ask the learner.',
            }
          : proposed.length
            ? {
                proposal: { mode, items: proposed },
                alreadyOnPlan,
                saved: false,
                ...(outsideShortlist.length
                  ? {
                      outsideShortlist,
                      note: 'The learner chose these outside the shortlist. Proposed as asked; mention in one line if one was attempted before or is above their level.',
                    }
                  : {}),
              }
            : { saved: false, alreadyOnPlan, note: "These are already on today's plan." };
    } else if (name === 'confirm_plan_change') {
      const { idempotencyKey, ...body } = schemas.confirm_plan_change.parse(args);
      result = await api.request('POST', '/api/daily-plan/changes', body, idempotencyKey);
    } else if (name === 'get_study_list') {
      schemas.get_study_list.parse(args);
      const list = (await api.request('GET', '/api/study-list')) as StudyListView;
      result = {
        planSource: list.planSource,
        name: list.name,
        next: list.remaining.slice(0, 10),
        remaining: list.remaining.length,
        finished: list.finished.length,
        notInLibrary: list.notInLibrary.length,
        courses: await api.request('GET', '/api/study-sets'),
      };
    } else if (name === 'propose_study_list') {
      const input = schemas.propose_study_list.parse(args);
      if (input.planSource === 'bloom') {
        result = { proposal: { planSource: 'bloom', name: null, slugs: null }, saved: false };
      } else if (!input.set && !input.problems) {
        const list = (await api.request('GET', '/api/study-list')) as StudyListView;
        result = list.slugs.length
          ? {
              proposal: {
                planSource: 'list',
                name: list.name,
                slugs: null,
                preview: {
                  total: list.slugs.length,
                  inLibrary: list.remaining.length + list.finished.length,
                  firstUp: list.remaining.slice(0, 3),
                },
              },
              saved: false,
            }
          : { saved: false, note: 'No saved study list. Propose a course or slugs.' };
      } else {
        const preview = (await api.request('POST', '/api/study-list/preview', {
          set: input.set,
          from: input.from,
          problems: input.problems,
        })) as {
          name: string | null;
          slugs: string[];
          inLibrary: number;
          firstUp: string[];
          unmatched: string[];
        };
        result = !preview.inLibrary
          ? {
              saved: false,
              note: "None of these problems are in the learner's library yet. Suggest downloading the problem bank in Settings first.",
            }
          : {
              proposal: {
                planSource: 'list',
                name: input.name ?? preview.name,
                slugs: preview.slugs,
                preview: {
                  total: preview.slugs.length,
                  inLibrary: preview.inLibrary,
                  firstUp: preview.firstUp,
                },
              },
              // Titles not in the library: kept under LeetCode's usual slug, joining once added.
              notInLibrary: preview.unmatched,
              saved: false,
            };
      }
    } else if (name === 'confirm_study_list') {
      const { idempotencyKey, ...body } = schemas.confirm_study_list.parse(args);
      result = await api.request('POST', '/api/study-list/changes', body, idempotencyKey);
    } else if (name === 'get_topic_scores') {
      const { limit = 20 } = schemas.get_topic_scores.parse(args);
      result = await api.request('GET', `/api/topics/scores?limit=${limit}`);
    } else if (name === 'get_recent_attempts') {
      const input = schemas.get_recent_attempts.parse(args);
      const params = new URLSearchParams();
      if (input.problem !== undefined) params.set('q', input.problem);
      if (input.startedAfter !== undefined) params.set('startedAfter', input.startedAfter);
      if (input.limit !== undefined) params.set('limit', String(input.limit));
      result = await api.request('GET', `/api/attempts?${params}`);
    } else if (name === 'get_learning_insights') {
      schemas.get_learning_insights.parse(args);
      result = await api.request('GET', '/api/insights');
    } else if (name === 'retrieve_learning_evidence')
      result = await api.request(
        'POST',
        '/api/insights/retrieve',
        schemas.retrieve_learning_evidence.parse(args),
      );
    else if (name === 'get_today')
      result = await api.request('POST', '/api/daily-plan/ensure', schemas.get_today.parse(args));
    else if (name === 'search_questions') {
      const input = schemas.search_questions.parse(args);
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) params.set(k, Array.isArray(v) ? v.join(',') : String(v));
      result = await api.request('GET', `/api/problems?${params}`);
    } else if (name === 'get_attempt_context')
      result = await api.request(
        'GET',
        `/api/attempts/${schemas.get_attempt_context.parse(args).attemptId}/context`,
      );
    else if (name === 'finish_attempt' || name === 'save_review') {
      const { attemptId, idempotencyKey, ...body } = (
        name === 'finish_attempt' ? schemas.finish_attempt : schemas.save_review
      ).parse(args);
      const committed = await api.request(
        'POST',
        `/api/attempts/${attemptId}/${name === 'finish_attempt' ? 'finish' : 'reviews'}`,
        body,
        idempotencyKey,
      );
      let current: unknown;
      try {
        current = await api.request(
          'GET',
          `/api/attempts/${attemptId}${name === 'save_review' ? '/context' : ''}`,
        );
      } catch {
        throw new ApiError(
          'COMMITTED_READBACK_FAILED',
          'Write committed but read-back failed. Do not create a new key; retry identical arguments with the SAME key.',
        );
      }
      const identity = z.object({ id: z.string(), version: z.number().int() });
      const saved = identity.safeParse(
        name === 'save_review' ? (committed as { attempt?: unknown })?.attempt : committed,
      );
      const readback = identity.safeParse(
        name === 'save_review' ? (current as { attempt?: unknown })?.attempt : current,
      );
      if (
        !saved.success ||
        !readback.success ||
        saved.data.id !== attemptId ||
        readback.data.id !== attemptId ||
        readback.data.version < saved.data.version
      )
        throw new ApiError(
          'COMMITTED_READBACK_MISMATCH',
          'Write returned but its attempt identity/version did not match read-back. Re-read before further edits; retain the original idempotency key.',
        );
      const pending =
        name === 'finish_attempt' && !(committed as { feedback?: string | null })?.feedback;
      result = {
        committed,
        current,
        verified: true,
        ...(pending
          ? {
              reviewPending: true,
              nextStep:
                'No tutor note is saved for this attempt yet. Call save_review now so the learner sees a summary of it in the app.',
            }
          : {}),
      };
    } else if (name === 'set_review_date') {
      const { targetId, ...body } = schemas.set_review_date.parse(args);
      const committed = await api.request('PATCH', `/api/reviews/${targetId}`, body);
      const targets = await api.request('GET', '/api/reviews');
      const current = Array.isArray(targets)
        ? targets.find((t: { id?: string }) => t.id === targetId)
        : undefined;
      if (!current)
        throw new ApiError(
          'COMMITTED_READBACK_FAILED',
          'Schedule write committed but target could not be read back. Read current targets before retrying.',
        );
      result = { committed, current, verified: true };
    } else throw new ApiError('UNKNOWN_TOOL', 'Unknown tool.');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    const data =
      error instanceof ApiError
        ? { code: error.code, message: error.message, status: error.status }
        : error instanceof z.ZodError
          ? { code: 'INVALID_ARGUMENTS', message: 'Arguments do not match the tool schema.' }
          : { code: 'INTERNAL_ERROR', message: 'Unexpected adapter error.' };
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify({ error: data }) }],
    };
  }
}
export async function startMcp() {
  const api = new LocalApi();
  const server = new Server(
    { name: 'bloomcode', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(api, request.params.name, request.params.arguments ?? {}),
  );
  await server.connect(new StdioServerTransport());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startMcp().catch(() => {
    process.stderr.write('BloomCode MCP failed to start. Check local runtime settings.\n');
    process.exitCode = 1;
  });
