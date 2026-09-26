// Review scheduling: when a problem should come back, and the stored review target.
import { randomUUID } from 'node:crypto';
import type { ReviewTarget } from '../../shared/contracts.js';
import { type Db, insert, many, update } from '../db/db.js';
import { ApiError } from '../db/errors.js';
import type { AttemptRecord } from './attempt-model.js';
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Interval rules v1: repair -> reconstruction -> transfer -> mixed. */
export function recommendation(
  a: Pick<AttemptRecord, 'outcome' | 'help' | 'evidence' | 'studyDate'>,
) {
  const repair = a.outcome !== 'solved' || ['major', 'solution', 'unknown'].includes(a.help);
  const days = repair ? 1 : a.help === 'small' ? 3 : a.evidence === 'retention' ? 7 : 14;
  return {
    date: addDays(a.studyDate, days),
    stage: repair
      ? 'repair'
      : a.help === 'small'
        ? 'reconstruction'
        : a.evidence === 'retention'
          ? 'transfer'
          : 'mixed',
  };
}
/** Review targets with their problem's title. `where` may refer to the target as `r`. */
export function reviewTargets(db: Db, where = '', ...params: string[]): ReviewTarget[] {
  return many<ReviewTarget>(
    db,
    `SELECT r.*, p.title AS problemTitle FROM review_targets r JOIN problems p ON p.id = r.problemId ${where} ORDER BY r.rowid`,
    ...params,
  );
}
export function updateTarget(
  db: Db,
  problemId: string,
  recommendedDate: string | null,
  stage: string,
  choice?: { action: ReviewTarget['action']; date?: string | null },
): ReviewTarget {
  const [prior] = reviewTargets(db, 'WHERE r.problemId = ?', problemId);
  const t = prior
    ? { ...prior, version: prior.version + 1, recommendedDate, stage }
    : {
        id: randomUUID(),
        problemId,
        recommendedDate,
        effectiveDate: recommendedDate,
        action: 'recommended' as ReviewTarget['action'],
        version: 1,
        stage,
      };
  if (choice && choice.action !== 'recommended') {
    if ((choice.action === 'manual' || choice.action === 'snooze') && !choice.date)
      throw new ApiError(400, 'VALIDATION', 'A date is required for this review action');
    t.action = choice.action;
    t.effectiveDate = choice.action === 'none' ? null : choice.date!;
  } else if (t.action === 'recommended') t.effectiveDate = recommendedDate;
  const { id, recommendedDate: rec, effectiveDate, action, version, stage: st } = t;
  if (prior)
    update(db, 'review_targets', id, {
      recommendedDate: rec,
      effectiveDate,
      action,
      version,
      stage: st,
    });
  else
    insert(db, 'review_targets', {
      id,
      problemId,
      recommendedDate: rec,
      effectiveDate,
      action,
      version,
      stage: st,
    });
  return reviewTargets(db, 'WHERE r.id = ?', id)[0]!;
}
