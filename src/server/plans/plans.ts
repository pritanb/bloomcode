import { reflectionSafeView } from '../attempts/attempt-model.js';
import { activityDays } from '../topics/study-tools.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlanItem } from '../../shared/contracts.js';
import { type Db, insert, many, maybe, run, transaction, update } from '../db/db.js';
import { idempotent } from '../db/idempotency.js';
import { confirmedPlanChange } from '../../shared/plan-changes.js';
import { readSettings } from '../db/settings.js';
import { assertMetadataVisible, date, problemView } from '../catalogue/problem-model.js';
import {
  activeAttempt,
  attempts,
  attemptView,
  NEWEST,
  studyDate,
} from '../attempts/attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import { decisions, topics } from '../topics/topic-model.js';
import { updateTarget } from '../attempts/review-schedule.js';
import {
  type PlanRecord,
  type ItemRecord,
  planView,
  bumpPlan,
  planItems,
  getItem,
  getPlan,
  findPlan,
} from './plan-model.js';
import { defaultPicks, shortlist, type PlanSpec } from './shortlist.js';
import { targetRating, trainingLevels } from '../topics/training-levels.js';
import { problemRating } from '../topics/ratings.js';

/**
 * Bloom planning today's questions (the tutor features provide it). While it plans,
 * today's plan stays empty; when it can't, the built-in rules fill the day.
 */
export interface BloomPlanner {
  active(): boolean;
  /** Ask Bloom to plan this plan once; returns whether Bloom is (still) planning it. */
  request(planId: string): boolean;
  /** Ask Bloom to plan unstarted questions again. */
  replan(planId: string): void;
  /** The built-in rules took over: a late Bloom result must not replace them. */
  supersede(planId: string): void;
}
declare module 'fastify' {
  interface FastifyInstance {
    bloomPlanner: BloomPlanner | null;
  }
}

function newItem(
  db: Db,
  plan: PlanRecord,
  spec: Pick<PlanSpec, 'problemId' | 'reason' | 'kind' | 'reviewOf'>,
  status: PlanItem['status'],
  position: number,
) {
  const id = randomUUID();
  insert(db, 'plan_items', {
    id,
    planId: plan.id,
    position,
    problemId: spec.problemId,
    status,
    reason: spec.reason,
    // A topic pick's reason names its topic: known-topic practice, never unseen evidence.
    recommendationKind: spec.kind,
    reviewOf: spec.reviewOf,
    attemptId: null,
  });
  return id;
}
/** The built-in day: due checks, then the weakest topics (see shortlist.ts). */
export function rulePicks(db: Db, now: Date, slots: number, exclude: Set<string>, day?: string) {
  return defaultPicks(db, shortlist(db, now, { exclude, day }), slots, exclude);
}
export const slotsFor = (s: ReturnType<typeof readSettings>) =>
  s.questionsPerDay ?? s.primaryCount + s.optionalCount;
/** Started or finished work, which a plan change never removes. */
export const isStarted = (db: Db, i: ItemRecord) =>
  !!i.attemptId ||
  ['completed', 'skipped'].includes(i.status) ||
  !!maybe(db, 'SELECT 1 FROM attempts WHERE planItemId = ?', i.id);
type ChangeSpec = Pick<PlanSpec, 'problemId' | 'title' | 'reason'> &
  Partial<Pick<PlanSpec, 'kind' | 'reviewOf'>>;
/**
 * Apply picks to a plan. "add" appends; "replace" first removes unstarted items.
 * Problems already on the plan (and not skipped) are never added twice.
 */
export function applyPlanChange(
  db: Db,
  planId: string,
  mode: 'add' | 'replace',
  picks: ChangeSpec[],
) {
  const plan = getPlan(db, planId);
  let items = planItems(db, 'WHERE i.planId = ?', plan.id);
  const removed: string[] = [];
  // A replaced item picked again keeps what it was checking (and a transfer check its label).
  const was = new Map<string, ItemRecord>();
  if (mode === 'replace')
    for (const item of items.filter((i) => !isStarted(db, i))) {
      run(db, 'DELETE FROM plan_items WHERE id = ?', item.id);
      removed.push(item.title);
      was.set(item.problemId, item);
    }
  items = planItems(db, 'WHERE i.planId = ?', plan.id);
  const planned = new Set(items.filter((i) => i.status !== 'skipped').map((i) => i.problemId));
  let hasActive = items.some((i) => i.status === 'active');
  let position = Math.max(-1, ...items.map((i) => i.position)) + 1;
  const added: string[] = [];
  for (const pick of picks) {
    const problem = problemView(db, pick.problemId);
    if (problem.title !== pick.title)
      throw conflict('Problem title does not match the change shown for confirmation');
    if (planned.has(problem.id)) continue;
    planned.add(problem.id);
    const prior = pick.reviewOf === undefined ? was.get(problem.id) : undefined;
    const check = prior?.reviewOf
      ? {
          reviewOf: prior.reviewOf,
          kind: prior.recommendationKind ? ('topic' as const) : null,
          reason: prior.recommendationKind ? pick.reason : prior.reason,
        }
      : null;
    newItem(
      db,
      plan,
      check
        ? { problemId: problem.id, ...check }
        : {
            problemId: problem.id,
            reason: pick.reason,
            kind: pick.kind === undefined ? 'topic' : pick.kind,
            reviewOf: pick.reviewOf ?? null,
          },
      hasActive ? 'queued' : 'active',
      position++,
    );
    hasActive = true;
    added.push(problem.title);
  }
  const kept = removed.filter((t) => added.includes(t));
  if (added.length || removed.length) bumpPlan(db, plan.id);
  return {
    added: added.filter((t) => !kept.includes(t)),
    removed: removed.filter((t) => !kept.includes(t)),
    plan: planView(db, getPlan(db, plan.id)),
  };
}
/** Fill an untouched plan with the built-in rules (Bloom off, failed or superseded). */
export function fillWithRules(db: Db, clock: () => Date, planId: string) {
  const plan = getPlan(db, planId);
  if (maybe(db, 'SELECT 1 FROM plan_items WHERE planId = ?', plan.id)) return;
  const picks = rulePicks(db, clock(), slotsFor(readSettings(db)), new Set(), plan.date);
  if (!picks.length) return;
  bumpPlan(db, plan.id);
  for (const [i, p] of picks.entries())
    newItem(db, getPlan(db, plan.id), p, i === 0 ? 'active' : 'queued', i);
}
/** Today's plan (or the one holding the active attempt), generating it on first use. */
export function ensurePlan(
  db: Db,
  clock: () => Date,
  requested?: string,
  planner?: BloomPlanner | null,
) {
  const settings = readSettings(db),
    today = studyDate(clock(), settings.timezone),
    day = requested ?? today,
    active = activeAttempt(db);
  if (active?.planItemId) return planView(db, getPlan(db, getItem(db, active.planItemId).planId));
  let plan = findPlan(db, day, settings.timezone);
  // Plans are generated here; version 1 with no items is the untouched empty state.
  if (
    plan &&
    (plan.version !== 1 || maybe(db, 'SELECT 1 FROM plan_items WHERE planId = ?', plan.id))
  )
    return planView(db, plan);
  if (!plan)
    plan = insert(db, 'daily_plans', {
      id: randomUUID(),
      date: day,
      timezone: settings.timezone,
      version: 1,
    });
  if (active) {
    // An unplanned attempt in progress keeps the first slot.
    newItem(
      db,
      plan,
      { problemId: active.problemId, reason: 'Current attempt', kind: null, reviewOf: null },
      'active',
      0,
    );
    const item = planItems(db, 'WHERE i.planId = ?', plan.id)[0]!;
    update(db, 'attempts', active.id, { planItemId: item.id });
    update(db, 'plan_items', item.id, { attemptId: active.id });
    const slots = slotsFor(settings) - 1;
    const exclude = new Set([active.problemId]);
    for (const [i, p] of rulePicks(db, clock(), slots, exclude, day).entries())
      newItem(db, plan, p, 'queued', i + 1);
    return planView(db, plan);
  }
  // Bloom decides today's plan when the tutor is on; it stays empty while Bloom plans.
  if (day === today && planner?.active() && planner.request(plan.id)) return planView(db, plan);
  planner?.supersede(plan.id);
  fillWithRules(db, clock, plan.id);
  return planView(db, getPlan(db, plan.id));
}
export function registerPlans(app: FastifyInstance, db: Db, clock: () => Date) {
  app.decorate('bloomPlanner', null);
  app.get('/api/training-levels', () => {
    assertMetadataVisible(db);
    return { target: targetRating(db), levels: trainingLevels(db) };
  });
  app.get('/api/recommendations/shortlist', (req) => {
    assertMetadataVisible(db);
    const q = z
      .object({ topic: z.string().min(1).max(100).optional() })
      .strict()
      .parse(req.query);
    return shortlist(db, clock(), { topic: q.topic, perTopic: q.topic ? 10 : 5 });
  });
  app.post<{ Params: { id: string } }>('/api/daily-plans/:id/reorder', (req) => {
    const b = z
      .object({ version: z.number().int().min(1), itemIds: z.array(z.string()).min(1) })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const plan = getPlan(db, req.params.id);
      if (plan.version !== b.version)
        throw conflict('The plan changed. Refresh before reordering.');
      const items = planItems(db, 'WHERE i.planId = ?', plan.id);
      if (
        b.itemIds.length !== items.length ||
        new Set(b.itemIds).size !== items.length ||
        b.itemIds.some((id) => !items.some((i) => i.id === id))
      )
        throw new ApiError(400, 'VALIDATION', 'Include each plan item exactly once');
      const ordered = b.itemIds.map((id) => items.find((i) => i.id === id)!);
      const live = ordered.some((i) => i.attemptId && !['completed', 'skipped'].includes(i.status));
      const next = ordered.find((i) => !['completed', 'skipped'].includes(i.status));
      ordered.forEach((item, position) =>
        update(db, 'plan_items', item.id, {
          position,
          ...(!live && next
            ? {
                status:
                  item.id === next.id
                    ? 'active'
                    : item.status === 'active'
                      ? 'queued'
                      : item.status,
              }
            : {}),
        }),
      );
      bumpPlan(db, plan.id);
      return planView(db, getPlan(db, plan.id));
    });
  });

  app.post('/api/daily-plan/ensure', (req) => {
    const b = z
      .object({ date: date.optional() })
      .strict()
      .parse(req.body ?? {});
    return transaction(db, () => ensurePlan(db, clock, b.date, app.bloomPlanner));
  });
  // Read-only for the tutor: today's plan if it exists, without generating one.
  app.get('/api/daily-plan/today', () => {
    assertMetadataVisible(db);
    const settings = readSettings(db);
    const plan = findPlan(db, studyDate(clock(), settings.timezone), settings.timezone);
    return {
      plan: plan ? planView(db, plan) : null,
      questionsPerDay: slotsFor(settings),
    };
  });
  // Read-only lookup for the tutor: resolve proposed titles against the library
  // so a confirmation card only ever names problems that exist.
  app.get('/api/daily-plan/lookup', (req) => {
    assertMetadataVisible(db);
    const { title } = z
      .object({
        title: z
          .union([z.string(), z.array(z.string())])
          .transform((t) => (Array.isArray(t) ? t : [t]))
          .pipe(z.array(z.string().trim().min(1).max(200)).min(1).max(10)),
      })
      .strict()
      .parse(req.query);
    const settings = readSettings(db);
    const plan = findPlan(db, studyDate(clock(), settings.timezone), settings.timezone);
    const items = plan ? planItems(db, 'WHERE i.planId = ?', plan.id) : [];
    const list = shortlist(db, clock(), { perTopic: 10 });
    const offered = new Set(list.topics.flatMap((t) => t.problems).map((p) => p.problemId));
    type Row = { id: string; title: string; slug: string; difficulty: string | null };
    return {
      results: title.map((requested) => {
        const exact = maybe<Row>(
          db,
          'SELECT id, title, slug, difficulty FROM problems WHERE lower(trim(title)) = lower(?) ORDER BY rowid LIMIT 1',
          requested,
        );
        if (exact) {
          const item = items.find((i) => i.problemId === exact.id && i.status !== 'skipped');
          return {
            requested,
            problemId: exact.id,
            title: exact.title,
            onPlan: !!item,
            started: !!item && isStarted(db, item),
            rating: problemRating(db, exact),
            onShortlist: offered.has(exact.id),
          };
        }
        const like = `%${requested.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
        const candidates = many<Row>(
          db,
          "SELECT id, title FROM problems WHERE lower(title) LIKE ? ESCAPE '\\' ORDER BY length(title), rowid LIMIT 3",
          like,
        );
        return { requested, problemId: null, candidates: candidates.map((c) => c.title) };
      }),
    };
  });
  // Scoped tutor credentials cannot enter this route. Only the host's explicit
  // confirmation flow uses the full local credential to commit the change.
  app.post('/api/daily-plan/changes', (req) => {
    assertMetadataVisible(db);
    const body = confirmedPlanChange.parse(req.body);
    return idempotent(db, 'plan-change', req.headers['idempotency-key'], body, () => {
      // A confirmed change wins over a Bloom plan still in progress for today.
      const plan = ensurePlan(db, clock);
      app.bloomPlanner?.supersede(plan.id);
      return applyPlanChange(db, plan.id, body.change.mode, body.change.items);
    });
  });
  app.post<{ Params: { id: string } }>('/api/daily-plans/:id/rebuild', (req) => {
    const b = z
      .object({ version: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const plan = getPlan(db, req.params.id),
        settings = readSettings(db);
      if (plan.version !== b.version)
        throw conflict('The plan changed. Refresh before rebuilding.');
      const active = activeAttempt(db);
      const current = active?.planItemId
        ? getItem(db, active.planItemId).planId === plan.id
        : plan.date === studyDate(clock(), settings.timezone) &&
          plan.timezone === settings.timezone;
      if (!current) throw conflict('Only the current plan can be rebuilt');
      // Bloom decides the plan when the tutor is on: ask it to plan unstarted questions again.
      if (app.bloomPlanner?.active()) {
        app.bloomPlanner.replan(plan.id);
        return planView(db, plan);
      }
      const items = planItems(db, 'WHERE i.planId = ?', plan.id);
      const keep = items.filter(
        (i) =>
          i.attemptId ||
          ['completed', 'skipped'].includes(i.status) ||
          maybe(db, 'SELECT 1 FROM attempts WHERE planItemId = ?', i.id),
      );
      const retained = keep.filter((i) => i.status !== 'skipped');
      const slots = slotsFor(settings);
      const available = rulePicks(
        db,
        clock(),
        Math.max(0, slots - retained.length),
        new Set(keep.map((i) => i.problemId)),
      );
      for (const item of items.filter((i) => !keep.includes(i)))
        run(db, 'DELETE FROM plan_items WHERE id = ?', item.id);
      const position = Math.max(-1, ...keep.map((i) => i.position)) + 1;
      const hasActive = keep.some((i) => i.status === 'active');
      for (const [index, p] of available.entries())
        newItem(db, plan, p, !hasActive && index === 0 ? 'active' : 'queued', position + index);
      bumpPlan(db, plan.id);
      return planView(db, getPlan(db, plan.id));
    });
  });
  app.get('/api/dashboard', (req) =>
    transaction(db, () => {
      const q = z.object({ date: date.optional() }).strict().parse(req.query),
        settings = readSettings(db),
        day = q.date ?? studyDate(clock(), settings.timezone),
        active = activeAttempt(db);
      let plan = findPlan(db, day, settings.timezone);
      if (!q.date && active?.planItemId) plan = getPlan(db, getItem(db, active.planItemId).planId);
      const hidden = active?.context === 'mixed';
      const [reflection] = hidden
        ? []
        : attempts(
            db,
            `WHERE a.status = 'completed' AND trim(coalesce(a.takeaway, '')) != '' ${NEWEST} LIMIT 1`,
          );
      return {
        plan: plan ? planView(db, plan) : null,
        topics: topics(db),
        movements: decisions(db, 'WHERE d.oldScore != d.newScore ORDER BY d.rowid DESC LIMIT 20'),
        recentAttempts: attempts(db, `WHERE a.status = 'completed' ${NEWEST} LIMIT 20`).map((a) =>
          reflectionSafeView(a, hidden),
        ),
        activeAttempt: active ? attemptView(active) : null,
        settings,
        activity: activityDays(db, day),
        latestReflection: reflection
          ? { attemptId: reflection.id, takeaway: reflection.takeaway! }
          : null,
      };
    }),
  );
  app.post<{ Params: { id: string } }>('/api/plan-items/:id/disposition', (req) => {
    const b = z
      .object({
        action: z.enum(['swap', 'snooze', 'skip']),
        until: date.optional(),
        reason: z.string().max(2000).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const item = getItem(db, req.params.id),
        plan = getPlan(db, item.planId);
      if (item.attemptId || ['completed', 'skipped'].includes(item.status))
        throw conflict('Only unstarted assignments may be changed');
      if (b.action === 'snooze') {
        if (!b.until || b.until <= studyDate(clock(), plan.timezone))
          throw new ApiError(400, 'VALIDATION', 'Snooze requires a future date');
        updateTarget(db, item.problemId, null, 'snoozed', { action: 'snooze', date: b.until });
      }
      if (b.action === 'swap') {
        const items = planItems(db, 'WHERE i.planId = ?', plan.id),
          [replacement] = rulePicks(
            db,
            clock(),
            1,
            new Set(items.map((i) => i.problemId)),
            plan.date,
          );
        if (!replacement) throw conflict('No other question fits your current training levels');
        newItem(db, plan, replacement, item.status, items.length);
      }
      update(db, 'plan_items', item.id, { status: 'skipped', reason: b.reason ?? b.action });
      if (item.status === 'active') {
        const next = maybe<{ id: string }>(
          db,
          `SELECT id FROM plan_items WHERE planId = ? AND status IN ('queued', 'optional') ORDER BY position, rowid LIMIT 1`,
          plan.id,
        );
        if (next) update(db, 'plan_items', next.id, { status: 'active' });
      }
      bumpPlan(db, plan.id);
      return planView(db, getPlan(db, plan.id));
    });
  });
  app.post<{ Params: { id: string } }>('/api/plan-items/:id/activate', (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return transaction(db, () => {
      const item = getItem(db, req.params.id);
      if (['completed', 'skipped'].includes(item.status))
        throw conflict('Assignment is no longer available');
      if (
        maybe(
          db,
          "SELECT 1 FROM attempts WHERE status != 'completed' AND (planItemId IS NULL OR planItemId != ?)",
          item.id,
        )
      )
        throw conflict('Finish the active attempt first');
      run(
        db,
        `UPDATE plan_items SET status = 'queued' WHERE planId = ? AND status = 'active' AND id != ?`,
        item.planId,
        item.id,
      );
      update(db, 'plan_items', item.id, { status: 'active' });
      bumpPlan(db, item.planId);
      return planView(db, getPlan(db, item.planId));
    });
  });
}
