import { reflectionSafeView } from '../attempts/attempt-model.js';
import {
  configuredCandidates,
  recommendationContext,
  recommendationReason,
} from './recommendations.js';
import { activityDays } from '../topics/study-tools.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlanItem, Problem, ReviewTarget } from '../../shared/contracts.js';
import { type Db, insert, maybe, run, transaction, update } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { date, problemViews, problemView } from '../catalogue/problem-model.js';
import {
  activeAttempt,
  attempts,
  attemptView,
  NEWEST,
  studyDate,
} from '../attempts/attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import { decisions, topicRows, topics } from '../topics/topic-model.js';
import { reviewTargets, updateTarget } from '../attempts/review-schedule.js';
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
function refresherCount(db: Db, items: ItemRecord[]) {
  const ctx = recommendationContext(db);
  return items.filter(
    (i) =>
      i.status !== 'skipped' &&
      (i.recommendationKind
        ? i.recommendationKind === 'refresher'
        : ctx.complete(problemView(db, i.problemId))),
  ).length;
}
/** Problems in the order they should be offered: due reviews, weakest topic, least recent. */
function candidates(db: Db, day: string, exclude = new Set<string>()): Problem[] {
  const reviews = reviewTargets(db),
    scores = topicRows(db);
  const due = (p: Problem) =>
    reviews.find((t) => t.problemId === p.id && t.effectiveDate && t.effectiveDate <= day);
  const weakness = (p: Problem) =>
    Math.min(
      5,
      ...p.tags.map(
        (tag) => scores.find((t) => t.name.toLowerCase() === tag.name.toLowerCase())?.score ?? 5,
      ),
    );
  const waiting = (p: Problem) =>
    reviews.some(
      (t: ReviewTarget) =>
        t.problemId === p.id &&
        (t.action === 'none' || (t.effectiveDate !== null && t.effectiveDate > day)),
    );
  return problemViews(db)
    .filter((p) => !exclude.has(p.id) && !waiting(p))
    .sort(
      (a, b) =>
        Number(!!due(b)) - Number(!!due(a)) ||
        (due(a)?.effectiveDate ?? '').localeCompare(due(b)?.effectiveDate ?? '') ||
        weakness(a) - weakness(b) ||
        (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? '') ||
        a.id.localeCompare(b.id),
    );
}
function newItem(
  db: Db,
  plan: PlanRecord,
  p: Problem,
  status: PlanItem['status'],
  position: number,
) {
  const ctx = recommendationContext(db);
  const id = randomUUID();
  insert(db, 'plan_items', {
    id,
    planId: plan.id,
    position,
    problemId: p.id,
    status,
    reason: recommendationReason(db, p, plan.date),
    recommendationKind: ctx.complete(p)
      ? 'refresher'
      : ctx.config.strategy === 'topic'
        ? 'topic'
        : 'balanced',
    attemptId: null,
  });
  return id;
}
const slotsFor = (s: ReturnType<typeof readSettings>) =>
  s.questionsPerDay ?? s.primaryCount + s.optionalCount;
export function registerPlans(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/recommendations/options', (req) => {
    const q = z
      .object({ listId: z.string().optional(), startTopic: z.string().optional() })
      .strict()
      .parse(req.query);
    const config = readSettings(db).recommendations;
    const base = recommendationContext(db).config;
    return recommendationContext(db, {
      ...base,
      ...config,
      ...(q.listId !== undefined
        ? { listId: q.listId || null, startTopic: q.startTopic || null }
        : {}),
    }).options;
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
    return transaction(db, () => {
      const settings = readSettings(db),
        day = b.date ?? studyDate(clock(), settings.timezone),
        active = activeAttempt(db);
      if (active?.planItemId)
        return planView(db, getPlan(db, getItem(db, active.planItemId).planId));
      let plan = findPlan(db, day, settings.timezone);
      // Plans are generated here; version 1 with no items is the untouched empty state.
      if (
        plan &&
        (plan.version !== 1 || maybe(db, 'SELECT 1 FROM plan_items WHERE planId = ?', plan.id))
      )
        return planView(db, plan);
      const refilling = !!plan;
      if (!plan)
        plan = insert(db, 'daily_plans', {
          id: randomUUID(),
          date: day,
          timezone: settings.timezone,
          version: 1,
        });
      const slots = slotsFor(settings);
      const retained = active ? [problemView(db, active.problemId)] : [];
      const available = [
        ...retained,
        ...configuredCandidates(
          db,
          candidates(db, day, new Set(retained.map((p) => p.id))),
          slots - retained.length,
          retained.filter(recommendationContext(db).complete).length,
        ),
      ];
      if (refilling && available.length) {
        bumpPlan(db, plan.id);
        plan = getPlan(db, plan.id);
      }
      for (const [i, p] of available.slice(0, slots).entries()) {
        const item = newItem(db, plan, p, i === 0 ? 'active' : 'queued', i);
        if (i === 0 && active) {
          update(db, 'attempts', active.id, { planItemId: item });
          update(db, 'plan_items', item, { attemptId: active.id });
        }
      }
      return planView(db, plan);
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
      const items = planItems(db, 'WHERE i.planId = ?', plan.id);
      const keep = items.filter(
        (i) =>
          i.attemptId ||
          ['completed', 'skipped'].includes(i.status) ||
          maybe(db, 'SELECT 1 FROM attempts WHERE planItemId = ?', i.id),
      );
      const retained = keep.filter((i) => i.status !== 'skipped');
      const slots = slotsFor(settings);
      const available = configuredCandidates(
        db,
        candidates(
          db,
          studyDate(clock(), settings.timezone),
          new Set(keep.map((i) => i.problemId)),
        ),
        Math.max(0, slots - retained.length),
        refresherCount(db, keep),
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
          replacement = configuredCandidates(
            db,
            candidates(db, plan.date, new Set(items.map((i) => i.problemId))),
            1,
            refresherCount(
              db,
              items.filter((i) => i.id !== item.id),
            ),
          )[0];
        if (!replacement)
          throw conflict('No alternative candidate available within your recommendation settings');
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
