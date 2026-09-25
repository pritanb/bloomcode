import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Problem, ReviewTarget } from '../shared/contracts.js';
import { completeAssignment } from './plans.js';
import { Store } from './store.js';
import { date } from './catalogue.js';
import { type AttemptRecord, attemptView, checkVersion, version } from './attempts.js';
import { ApiError, conflict } from './errors.js';
import { applyAutoScore } from './auto-score.js';
import { idempotent } from './idempotency.js';
import type { AutoReviewQueue } from './auto-review.js';
export const outcome = z.enum(['solved', 'not_solved', 'stopped']);
export const help = z.enum(['none', 'small', 'major', 'solution', 'unknown']);
export const seconds = z.number().int().min(0).max(604800).nullable();
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
export function registerCloseout(
  app: FastifyInstance,
  s: Store,
  clock: () => Date,
  reviews?: AutoReviewQueue,
) {
  app.post<{ Params: { id: string } }>('/api/attempts/:id/finish', (req) => {
    const b = z
      .object({
        version,
        outcome,
        help,
        activeSeconds: seconds,
        code: z.string().max(1000000).optional(),
        notes: z.string().max(100000).optional(),
        confidence: z.number().min(1).max(5).nullable().optional(),
        reviewDate: date.nullable().optional(),
        reviewAction: z.enum(['recommended', 'manual', 'none']).optional(),
        requestReview: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const result = idempotent(
      s,
      `finish:${req.params.id}`,
      req.headers['idempotency-key'],
      b,
      () => {
        const a = s.get<AttemptRecord>('attempts', req.params.id);
        checkVersion(a, b.version);
        if (a.status === 'completed') throw conflict('Attempt already completed');
        const { reviewDate: _date, reviewAction: _action, requestReview: _review, ...answer } = b;
        Object.assign(a, answer, {
          version: a.version + 1,
          status: 'completed',
          finishedAt: clock().toISOString(),
          runningSince: null,
          needsGapDecision: false,
          gapSeconds: 0,
        });
        const p = s.get<Problem>('problems', a.problemId);
        s.put('problems', {
          ...p,
          exposed: true,
          lastAttemptAt: a.finishedAt,
          lastOutcome: a.outcome,
          attemptCount: p.attemptCount + 1,
          ...(a.outcome === 'solved'
            ? { lastSolveSeconds: a.activeSeconds, lastSolveHelp: a.help }
            : {}),
        });
        const r = recommendation(a);
        a.nextReviewDate = updateTarget(s, p.id, r.date, r.stage, {
          action: b.reviewAction ?? 'recommended',
          date: b.reviewDate,
        }).effectiveDate;
        s.put('attempts', a);
        completeAssignment(s, a);
        s.put('answer_versions', {
          id: randomUUID(),
          attemptId: a.id,
          code: a.code,
          notes: a.notes,
          language: a.language,
          version: a.version,
          recordedAt: clock().toISOString(),
        });
        const decisions = applyAutoScore(s, a, clock);
        s.put('audit_events', {
          id: randomUUID(),
          action: 'finish_attempt',
          attemptId: a.id,
          ...(decisions.length ? { decisionIds: decisions.map((d) => d.id) } : {}),
          recordedAt: clock().toISOString(),
        });
        return attemptView(a);
      },
    );
    if (b.requestReview) reviews?.request(req.params.id);
    return result;
  });
  app.get('/api/reviews', () => s.all<ReviewTarget>('review_targets'));
  app.patch<{ Params: { id: string } }>('/api/reviews/:id', (req) => {
    const b = z
      .object({
        version,
        action: z.enum(['manual', 'snooze', 'none', 'recommended']),
        date: date.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const t = s.get<ReviewTarget>('review_targets', req.params.id);
      checkVersion(t, b.version);
      if (['manual', 'snooze'].includes(b.action) && !b.date)
        throw new ApiError(400, 'VALIDATION', 'A date is required');
      t.action = b.action;
      t.effectiveDate =
        b.action === 'none' ? null : b.action === 'recommended' ? t.recommendedDate : b.date!;
      t.version++;
      s.put('review_targets', t);
      const p = s.get<Problem>('problems', t.problemId);
      s.put('problems', { ...p, nextReviewDate: t.effectiveDate });
      return t;
    });
  });
}
