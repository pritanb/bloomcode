// Daily plan records and the plan-item changes that attempts trigger.
import type { DailyPlan, PlanItem } from '../../shared/contracts.js';
import { type Db, many, maybe, one, run, update } from '../db/db.js';
import { conflict, missing } from '../db/errors.js';
import type { AttemptRecord } from '../attempts/attempt-model.js';
export type PlanRecord = Omit<DailyPlan, 'items'>;
export interface ItemRecord extends PlanItem {
  planId: string;
  position: number;
}
type ItemRow = Omit<ItemRecord, 'recommendationKind'> & {
  recommendationKind: PlanItem['recommendationKind'] | null;
};
/** Plan items with their problem's title and link. `where` may refer to the item as `i`. */
export function planItems(db: Db, where = '', ...params: string[]): ItemRecord[] {
  return many<ItemRow>(
    db,
    `SELECT i.*, p.title, p.url FROM plan_items i JOIN problems p ON p.id = i.problemId ${where} ORDER BY i.rowid`,
    ...params,
  ).map(({ recommendationKind, ...i }) => ({
    ...i,
    ...(recommendationKind ? { recommendationKind } : {}),
  }));
}
export const getItem = (db: Db, id: string): ItemRecord => {
  const [item] = planItems(db, 'WHERE i.id = ?', id);
  if (!item) throw missing();
  return item;
};
export const getPlan = (db: Db, id: string) =>
  one<PlanRecord>(db, 'SELECT * FROM daily_plans WHERE id = ?', id);
export const findPlan = (db: Db, date: string, timezone: string) =>
  maybe<PlanRecord>(
    db,
    'SELECT * FROM daily_plans WHERE date = ? AND timezone = ?',
    date,
    timezone,
  );
export function planView(db: Db, p: PlanRecord): DailyPlan {
  const rank = (i: ItemRecord) =>
    i.status === 'active' ? 0 : ['completed', 'skipped'].includes(i.status) ? 2 : 1;
  return {
    ...p,
    items: planItems(db, 'WHERE i.planId = ?', p.id)
      .sort((a, b) => rank(a) - rank(b) || a.position - b.position)
      .map(({ planId: _plan, position: _pos, ...i }) => i),
  };
}
export function bumpPlan(db: Db, id: string) {
  run(db, 'UPDATE daily_plans SET version = version + 1 WHERE id = ?', id);
}
export function linkAttempt(db: Db, attempt: AttemptRecord) {
  if (!attempt.planItemId) return;
  const item = getItem(db, attempt.planItemId);
  if (
    item.problemId !== attempt.problemId ||
    ['completed', 'skipped'].includes(item.status) ||
    item.attemptId
  )
    throw conflict('Assignment does not match this attempt');
  run(
    db,
    `UPDATE plan_items SET status = 'queued' WHERE planId = ? AND status = 'active' AND id != ?`,
    item.planId,
    item.id,
  );
  update(db, 'plan_items', item.id, { status: 'active', attemptId: attempt.id });
  bumpPlan(db, item.planId);
}
export function completeAssignment(db: Db, a: AttemptRecord) {
  if (!a.planItemId) return;
  const item = getItem(db, a.planItemId);
  update(db, 'plan_items', item.id, { status: 'completed', attemptId: a.id });
  const next = maybe<{ id: string }>(
    db,
    `SELECT id FROM plan_items WHERE planId = ? AND status = 'queued' ORDER BY position, rowid LIMIT 1`,
    item.planId,
  );
  if (next) update(db, 'plan_items', next.id, { status: 'active' });
  bumpPlan(db, item.planId);
}
