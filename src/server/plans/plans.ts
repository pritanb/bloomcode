import { reflectionSafeView } from '../attempts/attempts.js';
import {
  configuredCandidates,
  recommendationContext,
  recommendationReason,
} from './recommendations.js';
import { activityDays } from '../topics/study-tools.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  DailyPlan,
  PlanItem,
  Problem,
  ReviewTarget,
  Settings,
  Topic,
  ScoreDecision,
} from '../../shared/contracts.js';
import { Store } from '../db/store.js';
import { date, problemView } from '../catalogue/catalogue.js';
import { type AttemptRecord, attemptView, newestAttempt, studyDate } from '../attempts/attempts.js';
import { ApiError, conflict } from '../db/errors.js';
import { topicView, decisionView } from '../topics/topics.js';
import { updateTarget } from '../attempts/closeout.js';
export interface PlanRecord extends Omit<DailyPlan, 'items'> {
  id: string;
}
export interface ItemRecord extends PlanItem {
  planId: string;
  position: number;
}
export function planView(s: Store, p: PlanRecord): DailyPlan {
  return {
    ...p,
    items: s
      .all<ItemRecord>('plan_items')
      .filter((i) => i.planId === p.id)
      .sort((a, b) => {
        const rank = (i: ItemRecord) =>
          i.status === 'active' ? 0 : ['completed', 'skipped'].includes(i.status) ? 2 : 1;
        return rank(a) - rank(b) || a.position - b.position;
      })
      .map(({ planId: _plan, position: _pos, ...i }) => i),
  };
}
export function bumpPlan(s: Store, id: string) {
  const p = s.get<PlanRecord>('daily_plans', id);
  s.put('daily_plans', { ...p, version: p.version + 1 });
}
function refresherCount(s: Store, items: ItemRecord[]) {
  const ctx = recommendationContext(s);
  return items.filter(
    (i) =>
      i.status !== 'skipped' &&
      (i.recommendationKind
        ? i.recommendationKind === 'refresher'
        : i.problemId && ctx.complete(s.get<Problem>('problems', i.problemId))),
  ).length;
}
function candidates(s: Store, day: string, exclude = new Set<string>()): Problem[] {
  const reviews = s.all<ReviewTarget>('review_targets'),
    topics = s.all<Topic>('topics');
  const planned = new Set(
    s
      .all<{ id: string; problemId: string | null; date: string; status: string }>('import_plans')
      .filter((p) => p.date <= day && !/(complete|done|skip|cancel)/i.test(p.status))
      .map((p) => p.problemId),
  );
  const due = (p: Problem) =>
    reviews.find((t) => t.problemId === p.id && t.effectiveDate && t.effectiveDate <= day);
  const weakness = (p: Problem) =>
    Math.min(
      5,
      ...problemView(s, p).tags.map(
        (tag) => topics.find((t) => t.name.toLowerCase() === tag.name.toLowerCase())?.score ?? 5,
      ),
    );
  return s
    .all<Problem>('problems')
    .filter(
      (p) =>
        !exclude.has(p.id) &&
        !reviews.some(
          (t) =>
            t.problemId === p.id &&
            (t.action === 'none' || (t.effectiveDate !== null && t.effectiveDate > day)),
        ),
    )
    .sort(
      (a, b) =>
        Number(!!due(b)) - Number(!!due(a)) ||
        (due(a)?.effectiveDate ?? '').localeCompare(due(b)?.effectiveDate ?? '') ||
        weakness(a) - weakness(b) ||
        Number(planned.has(b.id)) - Number(planned.has(a.id)) ||
        (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? '') ||
        a.id.localeCompare(b.id),
    );
}
function newItem(
  s: Store,
  plan: PlanRecord,
  p: Problem,
  status: PlanItem['status'],
  minutes: number,
  position: number,
) {
  const ctx = recommendationContext(s);
  return s.put('plan_items', {
    id: randomUUID(),
    planId: plan.id,
    position,
    problemId: p.id,
    title: p.title,
    url: p.url,
    status,
    reason: recommendationReason(s, p, plan.date),
    recommendationKind: ctx.complete(p)
      ? 'refresher'
      : ctx.config.strategy === 'topic'
        ? 'topic'
        : 'balanced',
    suggestedMinutes: Math.max(1, minutes),
    attemptId: null,
  } satisfies ItemRecord);
}
export function linkAttempt(s: Store, attempt: AttemptRecord) {
  if (!attempt.planItemId) return;
  const item = s.get<ItemRecord>('plan_items', attempt.planItemId);
  if (
    item.problemId !== attempt.problemId ||
    ['completed', 'skipped'].includes(item.status) ||
    item.attemptId
  )
    throw conflict('Assignment does not match this attempt');
  for (const other of s
    .all<ItemRecord>('plan_items')
    .filter((i) => i.planId === item.planId && i.status === 'active' && i.id !== item.id))
    s.put('plan_items', { ...other, status: 'queued' });
  s.put('plan_items', { ...item, status: 'active', attemptId: attempt.id });
  bumpPlan(s, item.planId);
}
export function completeAssignment(s: Store, a: AttemptRecord) {
  if (!a.planItemId) return;
  const item = s.get<ItemRecord>('plan_items', a.planItemId);
  s.put('plan_items', { ...item, status: 'completed', attemptId: a.id });
  const next = s
    .all<ItemRecord>('plan_items')
    .filter((i) => i.planId === item.planId && i.status === 'queued')
    .sort((a, b) => a.position - b.position)[0];
  if (next) s.put('plan_items', { ...next, status: 'active' });
  bumpPlan(s, item.planId);
}
export function registerPlans(app: FastifyInstance, s: Store, clock: () => Date) {
  app.get('/api/recommendations/options', (req) => {
    const q = z
      .object({ listId: z.string().optional(), startTopic: z.string().optional() })
      .strict()
      .parse(req.query);
    const config = s.get<Settings & { id: string }>('settings', 'singleton').recommendations;
    const base = recommendationContext(s).config;
    return recommendationContext(s, {
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
    return s.transaction(() => {
      const plan = s.get<PlanRecord>('daily_plans', req.params.id);
      if (plan.version !== b.version)
        throw conflict('The plan changed. Refresh before reordering.');
      const items = s.all<ItemRecord>('plan_items').filter((i) => i.planId === plan.id);
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
        s.put('plan_items', {
          ...item,
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
      bumpPlan(s, plan.id);
      return planView(s, s.get('daily_plans', plan.id));
    });
  });

  app.post('/api/daily-plan/ensure', (req) => {
    const b = z
      .object({ date: date.optional() })
      .strict()
      .parse(req.body ?? {});
    return s.transaction(() => {
      const settings = s.get<Settings & { id: string }>('settings', 'singleton'),
        day = b.date ?? studyDate(clock(), settings.timezone),
        active = s.all<AttemptRecord>('attempts').find((a) => a.status !== 'completed');
      if (active?.planItemId)
        return planView(
          s,
          s.get('daily_plans', s.get<ItemRecord>('plan_items', active.planItemId).planId),
        );
      let plan = s
        .all<PlanRecord>('daily_plans')
        .find((p) => p.date === day && p.timezone === settings.timezone);
      // Plans are generated here; version 1 with no items is the untouched empty state.
      if (
        plan &&
        (plan.version !== 1 || s.all<ItemRecord>('plan_items').some((i) => i.planId === plan!.id))
      )
        return planView(s, plan);
      const refilling = !!plan;
      plan ??= s.put('daily_plans', {
        id: randomUUID(),
        date: day,
        timezone: settings.timezone,
        version: 1,
      });
      const slots = settings.questionsPerDay ?? settings.primaryCount + settings.optionalCount,
        minutes = Math.floor(settings.budgetMinutes / slots);
      const retained = active ? [s.get<Problem>('problems', active.problemId)] : [];
      const available = [
        ...retained,
        ...configuredCandidates(
          s,
          candidates(s, day, new Set(retained.map((p) => p.id))),
          slots - retained.length,
          retained.filter(recommendationContext(s).complete).length,
        ),
      ];
      if (refilling && available.length)
        plan = s.put('daily_plans', { ...plan, version: plan.version + 1 });
      for (const [i, p] of available.slice(0, slots).entries()) {
        const item = newItem(s, plan, p, i === 0 ? 'active' : 'queued', minutes, i);
        if (i === 0 && active) {
          active.planItemId = item.id;
          s.put('attempts', active);
          s.put('plan_items', { ...item, attemptId: active.id });
        }
      }
      return planView(s, plan);
    });
  });
  app.post<{ Params: { id: string } }>('/api/daily-plans/:id/rebuild', (req) => {
    const b = z
      .object({ version: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const plan = s.get<PlanRecord>('daily_plans', req.params.id),
        settings = s.get<Settings & { id: string }>('settings', 'singleton');
      if (plan.version !== b.version)
        throw conflict('The plan changed. Refresh before rebuilding.');
      const attempts = s.all<AttemptRecord>('attempts'),
        active = attempts.find((a) => a.status !== 'completed');
      const current = active?.planItemId
        ? s.get<ItemRecord>('plan_items', active.planItemId).planId === plan.id
        : plan.date === studyDate(clock(), settings.timezone) &&
          plan.timezone === settings.timezone;
      if (!current) throw conflict('Only the current plan can be rebuilt');
      const items = s.all<ItemRecord>('plan_items').filter((i) => i.planId === plan.id);
      const keep = items.filter(
        (i) =>
          i.attemptId ||
          ['completed', 'skipped'].includes(i.status) ||
          attempts.some((a) => a.planItemId === i.id),
      );
      const retained = keep
        .filter((i) => i.status !== 'skipped' && i.problemId)
        .map((i) => s.get<Problem>('problems', i.problemId!));
      const slots = settings.questionsPerDay ?? settings.primaryCount + settings.optionalCount;
      const available = configuredCandidates(
        s,
        candidates(
          s,
          studyDate(clock(), settings.timezone),
          new Set(keep.flatMap((i) => (i.problemId ? [i.problemId] : []))),
        ),
        Math.max(0, slots - retained.length),
        refresherCount(s, keep),
      );
      for (const item of items.filter((i) => !keep.includes(i))) s.remove('plan_items', item.id);
      const position = Math.max(-1, ...keep.map((i) => i.position)) + 1;
      const hasActive = keep.some((i) => i.status === 'active');
      for (const [index, p] of available.entries())
        newItem(
          s,
          plan,
          p,
          !hasActive && index === 0 ? 'active' : 'queued',
          Math.floor(settings.budgetMinutes / slots),
          position + index,
        );
      bumpPlan(s, plan.id);
      return planView(s, s.get('daily_plans', plan.id));
    });
  });
  app.get('/api/dashboard', (req) =>
    s.transaction(() => {
      const q = z.object({ date: date.optional() }).strict().parse(req.query),
        settings = s.get<Settings & { id: string }>('settings', 'singleton'),
        day = q.date ?? studyDate(clock(), settings.timezone),
        active = s.all<AttemptRecord>('attempts').find((a) => a.status !== 'completed');
      let plan = s
        .all<PlanRecord>('daily_plans')
        .find((p) => p.date === day && p.timezone === settings.timezone);
      if (!q.date && active?.planItemId)
        plan = s.get('daily_plans', s.get<ItemRecord>('plan_items', active.planItemId).planId);
      const reflection =
        active?.context === 'mixed'
          ? undefined
          : s
              .all<AttemptRecord>('attempts')
              .filter((a) => a.status === 'completed' && !!a.takeaway?.trim())
              .sort(newestAttempt)[0];
      return {
        plan: plan ? planView(s, plan) : null,
        topics: s.all<Topic>('topics').map((t) => topicView(s, t)),
        movements: s
          .all<ScoreDecision>('score_decisions')
          .filter((d) => d.oldScore !== d.newScore)
          .reverse()
          .slice(0, 20)
          .map(decisionView),
        recentAttempts: s
          .all<AttemptRecord>('attempts')
          .filter((a) => a.status === 'completed')
          .sort(newestAttempt)
          .slice(0, 20)
          .map((a) => reflectionSafeView(a, active?.context === 'mixed')),
        activeAttempt: active ? attemptView(active) : null,
        settings,
        activity: activityDays(s, day),
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
    return s.transaction(() => {
      const item = s.get<ItemRecord>('plan_items', req.params.id),
        plan = s.get<PlanRecord>('daily_plans', item.planId);
      if (item.attemptId || ['completed', 'skipped'].includes(item.status))
        throw conflict('Only unstarted assignments may be changed');
      if (b.action === 'snooze') {
        if (!b.until || b.until <= studyDate(clock(), plan.timezone))
          throw new ApiError(400, 'VALIDATION', 'Snooze requires a future date');
        if (item.problemId)
          updateTarget(s, item.problemId, null, 'snoozed', { action: 'snooze', date: b.until });
      }
      if (b.action === 'swap') {
        const items = s.all<ItemRecord>('plan_items').filter((i) => i.planId === plan.id),
          replacement = configuredCandidates(
            s,
            candidates(
              s,
              plan.date,
              new Set(items.map((i) => i.problemId).filter((id): id is string => !!id)),
            ),
            1,
            refresherCount(
              s,
              items.filter((i) => i.id !== item.id),
            ),
          )[0];
        if (!replacement)
          throw conflict('No alternative candidate available within your recommendation settings');
        newItem(s, plan, replacement, item.status, item.suggestedMinutes, items.length);
      }
      s.put('plan_items', { ...item, status: 'skipped', reason: b.reason ?? b.action });
      if (item.status === 'active') {
        const next = s
          .all<ItemRecord>('plan_items')
          .filter((i) => i.planId === plan.id && ['queued', 'optional'].includes(i.status))
          .sort((a, b) => a.position - b.position)[0];
        if (next) s.put('plan_items', { ...next, status: 'active' });
      }
      bumpPlan(s, plan.id);
      return planView(s, s.get('daily_plans', plan.id));
    });
  });
  app.post<{ Params: { id: string } }>('/api/plan-items/:id/activate', (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return s.transaction(() => {
      const item = s.get<ItemRecord>('plan_items', req.params.id);
      if (['completed', 'skipped'].includes(item.status))
        throw conflict('Assignment is no longer available');
      if (
        s
          .all<AttemptRecord>('attempts')
          .some((a) => a.status !== 'completed' && a.planItemId !== item.id)
      )
        throw conflict('Finish the active attempt first');
      for (const other of s
        .all<ItemRecord>('plan_items')
        .filter((i) => i.planId === item.planId && i.status === 'active' && i.id !== item.id))
        s.put('plan_items', { ...other, status: 'queued' });
      s.put('plan_items', { ...item, status: 'active' });
      bumpPlan(s, item.planId);
      return planView(s, s.get('daily_plans', item.planId));
    });
  });
}
