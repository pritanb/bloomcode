// Bloom plans each day. The worker asks Bloom to choose today's questions from the
// training ladder's candidates and the ideas due for a check, and the result becomes the
// plan. When the tutor is off, paused or fails, the built-in rules fill the day instead.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Db, many, maybe, run, transaction } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { studyDate } from '../attempts/attempt-model.js';
import { assertMetadataVisible, problemViews } from '../catalogue/problem-model.js';
import { findPlan, planItems } from './plan-model.js';
import { activeNotes } from '../topics/tutor-notes.js';
import { notesInBudget } from '../../shared/tutor-notes.js';
import {
  applyPlanChange,
  ensurePlan,
  fillWithRules,
  isStarted,
  slotsFor,
  type BloomPlanner,
} from './plans.js';
import {
  attemptedIds,
  defaultPicks,
  fairCheck,
  CHECK_HEADROOM,
  practiceAfter,
  shortlist,
  TRANSFER_REASON,
  type Candidate,
  type DueCheck,
  type PlanSpec,
  type Shortlist,
} from './shortlist.js';
import { scoredAttempts, trainingLevels } from '../topics/training-levels.js';
import { problemRating } from '../topics/ratings.js';
import type { BloomPlanStatus } from '../../shared/plan-drafts.js';

const LEASE_MS = 240_000;
type Row = {
  planId: string;
  status: BloomPlanStatus['status'];
  claimId: string | null;
  claimedAt: number;
  summary: string | null;
  items: string | null;
  error: string | null;
};
export const draftReason = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((r) => r.split(/\s+/).length <= 30);

export interface PlanWork {
  planId: string;
  claimId: string;
  list: Shortlist;
  candidates: (Candidate & { topic: string })[];
  checks: DueCheck[];
  picksRequired: number;
  started: Set<string>;
  context: Record<string, unknown>;
}

export class PlanDrafts implements BloomPlanner {
  constructor(
    private db: Db,
    private clock: () => Date,
    private isActive: () => boolean = () => false,
  ) {}
  active() {
    return this.isActive();
  }
  private today() {
    const settings = readSettings(this.db);
    return findPlan(this.db, studyDate(this.clock(), settings.timezone), settings.timezone);
  }
  private row(planId: string) {
    return maybe<Row>(this.db, 'SELECT * FROM plan_drafts WHERE planId = ?', planId);
  }
  private put(planId: string, status: Row['status'], claimId: string | null, claimedAt: number) {
    run(
      this.db,
      'INSERT OR REPLACE INTO plan_drafts (planId, status, claimId, claimedAt) VALUES (?, ?, ?, ?)',
      planId,
      status,
      claimId,
      claimedAt,
    );
  }
  request(planId: string) {
    const row = this.row(planId);
    if (!row) {
      this.put(planId, 'pending', null, 0);
      return true;
    }
    return row.status === 'pending' || row.status === 'running';
  }
  replan(planId: string) {
    this.put(planId, 'pending', null, 0);
  }
  supersede(planId: string) {
    run(
      this.db,
      "UPDATE plan_drafts SET status = 'superseded' WHERE planId = ? AND status IN ('pending', 'running')",
      planId,
    );
  }
  /** What Bloom chooses from: candidates by topic (weakest first) and the due checks. */
  private work(planId: string): Omit<PlanWork, 'claimId'> {
    const db = this.db,
      now = this.clock(),
      settings = readSettings(db),
      items = planItems(db, 'WHERE i.planId = ?', planId),
      startedItems = items.filter((i) => isStarted(db, i)),
      started = new Set(startedItems.map((i) => i.problemId)),
      served = new Set(startedItems.flatMap((i) => (i.reviewOf ? [i.reviewOf] : []))),
      slots = slotsFor(settings),
      done = startedItems.filter((i) => i.status !== 'skipped').length,
      list = shortlist(db, now, { exclude: started }),
      candidates = list.topics.flatMap((t) => t.problems.map((p) => ({ ...p, topic: t.topic }))),
      checks = list.checks.filter((c) => !served.has(c.problemId)),
      scored = scoredAttempts(db),
      transfers = checks.filter((c) => c.kind === 'transfer').length,
      picksRequired = Math.min(Math.max(0, slots - done), candidates.length + transfers);
    const levels = trainingLevels(db, scored);
    return {
      planId,
      list,
      candidates,
      checks,
      picksRequired,
      started,
      context: {
        date: studyDate(now, settings.timezone),
        questionsPerDay: slots,
        picksRequired,
        targetRating: list.target,
        goals: many<{ text: string; createdAt: string }>(
          db,
          "SELECT text, createdAt FROM learning_goals WHERE state = 'active' ORDER BY updatedAt DESC LIMIT 10",
        ).map((g) => ({ text: g.text, agreedOn: g.createdAt.slice(0, 10) })),
        // Lessons the learner confirmed about Bloom's tutoring, for the topics on offer today.
        tutorNotes: notesInBudget(activeNotes(db), () => [
          ...candidates.map((c) => c.topic),
          ...checks.map((c) => c.topic),
        ]).notes.map((n) => ({ lesson: n.text, topic: n.topic })),
        topicLevels: levels.map((l) => ({
          topic: l.topic,
          level: l.level,
          atTarget: l.atTarget,
          attempts: l.attempts,
          lastResult: l.lastChange?.result ?? null,
        })),
        recentAttempts: scored
          .slice(-15)
          .reverse()
          .map((s) => ({
            title: s.problem.title,
            topic: s.topic,
            rating: s.rating.value,
            ratingEstimated: s.rating.estimated,
            date: s.attempt.studyDate,
            result: s.result,
          })),
        recentDifficulties: many<{ summary: string }>(
          db,
          `SELECT o.summary FROM insight_observations o WHERE o.polarity = 'difficulty'
           AND NOT EXISTS (SELECT 1 FROM insight_corrections c WHERE c.observationId = o.id)
           ORDER BY o.createdAt DESC LIMIT 5`,
        ).map((o) => o.summary.slice(0, 300)),
        alreadyStartedToday: startedItems.map((i) => ({ title: i.title, status: i.status })),
        checks: checks.map((c, index) => ({
          checkNumber: index + 1,
          kind: c.kind,
          problem: c.title,
          topic: c.topic,
          rating: c.rating,
          // A transfer check's problem must be about as hard as the original: no harder than this.
          ...(c.kind === 'transfer'
            ? { maxRating: Math.min(list.target, (c.rating ?? list.target) + CHECK_HEADROOM) }
            : {}),
        })),
        candidates: candidates.map((c, index) => ({
          candidateNumber: index + 1,
          title: c.title,
          topic: c.topic,
          topicLevel: list.topics.find((t) => t.topic === c.topic)!.level,
          rating: c.rating,
          ratingEstimated: c.estimated,
          popularity: c.popularity,
        })),
      },
    };
  }
  /** Claim today's pending plan for the worker. */
  claim(): PlanWork | null {
    return transaction(this.db, () => {
      // Never plan around live practice, and never disclose patterns during it.
      if (maybe(this.db, "SELECT 1 FROM attempts WHERE status != 'completed'")) return null;
      const plan = this.today();
      const row = plan && this.row(plan.id);
      if (!plan || !row) return null;
      const expired =
        row.status === 'running' && this.clock().getTime() - row.claimedAt >= LEASE_MS;
      if (row.status !== 'pending' && !expired) return null;
      const work = this.work(plan.id);
      if (!work.picksRequired) {
        // Nothing to choose: keep what is planned, or let the rules handle an empty day.
        const planned = !!maybe(this.db, 'SELECT 1 FROM plan_items WHERE planId = ?', plan.id);
        run(
          this.db,
          'UPDATE plan_drafts SET status = ? WHERE planId = ?',
          planned ? 'applied' : 'superseded',
          plan.id,
        );
        if (!planned) fillWithRules(this.db, this.clock, plan.id);
        return null;
      }
      const claimId = randomUUID();
      this.put(plan.id, 'running', claimId, this.clock().getTime());
      return { ...work, claimId };
    });
  }
  /** Turn Bloom's answer into plan items and make them today's plan. */
  complete(work: PlanWork, output: unknown) {
    const item = z
      .object({
        candidateNumber: z.number().int().nullable(),
        checkNumber: z.number().int().nullable(),
        sameIdea: z.array(z.string().max(200)).max(5),
        reason: z.string().max(300),
      })
      .strict();
    const result = z
      .object({ summary: z.string().trim().min(1).max(400), items: z.array(item).min(1).max(20) })
      .strict()
      .parse(output);
    const db = this.db;
    const problems = problemViews(db);
    const attempted = attemptedIds(db);
    const used = new Set(work.started);
    const checksUsed = new Set<number>();
    const specs: PlanSpec[] = [];
    const add = (spec: PlanSpec) => {
      used.add(spec.problemId);
      specs.push(spec);
    };
    // Unusable items (unknown numbers, a check without names) are skipped, not fatal.
    for (const i of result.items) {
      if (specs.length >= work.picksRequired) break;
      const check = i.checkNumber ? (work.checks[i.checkNumber - 1] ?? null) : null;
      if (check) {
        if (checksUsed.has(i.checkNumber!)) continue;
        checksUsed.add(i.checkNumber!);
      }
      if (check?.kind === 'transfer') {
        // Bloom names same-idea problems; the first fair one becomes the check.
        const named = i.sameIdea
          .map((t) => problems.find((p) => p.title.toLowerCase() === t.toLowerCase()))
          .find((p) => p && fairCheck(db, p, check, used, attempted));
        const spec: PlanSpec | null = named
          ? {
              problemId: named.id,
              title: named.title,
              reason: TRANSFER_REASON,
              kind: null,
              reviewOf: check.problemId,
            }
          : practiceAfter(db, work.list, check, used);
        if (spec) add(spec);
        continue;
      }
      const c = i.candidateNumber ? (work.candidates[i.candidateNumber - 1] ?? null) : null;
      if (!c || used.has(c.problemId)) continue;
      add({
        problemId: c.problemId,
        title: c.title,
        reason: draftReason.safeParse(i.reason).success ? i.reason : `${c.topic} practice`,
        kind: 'topic',
        // A repair is an easier problem from the struggled topic.
        reviewOf: check?.kind === 'repair' && check.topic === c.topic ? check.problemId : null,
      });
    }
    // Anything Bloom's answer couldn't fill comes from the built-in rules (no idea twice).
    const checked = new Set(specs.flatMap((s) => (s.reviewOf ? [s.reviewOf] : [])));
    if (specs.length < work.picksRequired)
      for (const spec of defaultPicks(
        db,
        work.list,
        work.picksRequired - specs.length,
        used,
        checked,
      ))
        add(spec);
    // Easier first, whatever order the answer used.
    const rating = new Map(problems.map((p) => [p.id, problemRating(db, p)?.value ?? Infinity]));
    specs.sort((a, b) => rating.get(a.problemId)! - rating.get(b.problemId)!);
    transaction(db, () => {
      // Superseded meanwhile (the rules or a confirmed chat change took over): drop it.
      const row = this.row(work.planId);
      if (row?.claimId !== work.claimId || row.status !== 'running') return;
      applyPlanChange(db, work.planId, 'replace', specs);
      run(
        db,
        "UPDATE plan_drafts SET status = 'applied', summary = ?, items = ?, error = NULL WHERE planId = ?",
        result.summary,
        // Bloom's answer beside what the app made of it, for troubleshooting.
        JSON.stringify({ answer: result.items, applied: specs }),
        work.planId,
      );
    });
  }
  fail(work: Pick<PlanWork, 'planId' | 'claimId'>, error: string) {
    transaction(this.db, () => {
      run(
        this.db,
        "UPDATE plan_drafts SET status = 'failed', error = ? WHERE planId = ? AND claimId = ? AND status = 'running'",
        error.slice(0, 1000),
        work.planId,
        work.claimId,
      );
      fillWithRules(this.db, this.clock, work.planId);
    });
  }
  view(): BloomPlanStatus | null {
    const plan = this.today();
    const row = plan && this.row(plan.id);
    if (!row) return null;
    return {
      planId: row.planId,
      status:
        row.status === 'running' && this.clock().getTime() - row.claimedAt >= LEASE_MS
          ? 'pending'
          : row.status,
      summary: row.summary,
      error: row.error,
    };
  }
}

export function registerPlanDrafts(
  app: FastifyInstance,
  db: Db,
  drafts: PlanDrafts,
  clock: () => Date,
) {
  app.get('/api/plan-drafts/today', () => ({ plan: drafts.view(), tutorActive: drafts.active() }));
  app.post('/api/plan-drafts/today/refresh', () => {
    assertMetadataVisible(db);
    return transaction(db, () => {
      const plan = ensurePlan(db, clock, undefined, drafts);
      if (drafts.active()) drafts.replan(plan.id);
      return { plan: drafts.view(), tutorActive: drafts.active() };
    });
  });
}
