// Daily plan records and the plan-item changes that attempts trigger.
import type { DailyPlan, PlanItem } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
import { conflict } from '../db/errors.js';
import type { AttemptRecord } from '../attempts/attempt-model.js';
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
