import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Problem, ReviewTarget } from '../../shared/contracts.js';
import { completeAssignment } from '../plans/plan-model.js';
import { Store } from '../db/store.js';
import { date } from '../catalogue/problem-model.js';
import { type AttemptRecord, attemptView, checkVersion, version } from './attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import { applyAutoScore } from '../scoring/auto-score.js';
import { idempotent } from '../db/idempotency.js';
import type { AutoReviewQueue } from './auto-review.js';
import { outcome, help, seconds } from './attempt-model.js';
import { recommendation, updateTarget } from './review-schedule.js';
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
