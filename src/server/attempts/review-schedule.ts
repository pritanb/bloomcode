// Review scheduling: when a problem should come back, and the stored review target.
import { randomUUID } from 'node:crypto';
import type { Problem, ReviewTarget } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
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
export function updateTarget(
  s: Store,
  problemId: string,
  recommendedDate: string | null,
  stage: string,
  choice?: { action: ReviewTarget['action']; date?: string | null },
): ReviewTarget {
  const p = s.get<Problem>('problems', problemId),
    prior = s
      .all<ReviewTarget>('review_targets')
      .find((t) => t.problemId === problemId && t.constraint === null);
  const t: ReviewTarget = prior
    ? { ...prior, version: prior.version + 1, recommendedDate, stage }
    : {
        id: randomUUID(),
        problemId,
        problemTitle: p.title,
        constraint: null,
        recommendedDate,
        effectiveDate: recommendedDate,
        action: 'recommended',
        version: 1,
        stage,
      };
  if (choice && choice.action !== 'recommended') {
    if ((choice.action === 'manual' || choice.action === 'snooze') && !choice.date)
      throw new ApiError(400, 'VALIDATION', 'A date is required for this review action');
    t.action = choice.action;
    t.effectiveDate = choice.action === 'none' ? null : choice.date!;
  } else if (t.action === 'recommended') t.effectiveDate = recommendedDate;
  s.put('review_targets', t);
  s.put('problems', { ...p, nextReviewDate: t.effectiveDate });
  return t;
}
