import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { completeAssignment, getItem } from '../plans/plan-model.js';
import { type Db, transaction, update } from '../db/db.js';
import { date } from '../catalogue/problem-model.js';
import { attemptView, checkVersion, getAttempt, version } from './attempt-model.js';
import { ApiError, conflict, missing } from '../db/errors.js';
import { applyAutoScore } from '../scoring/auto-score.js';
import { idempotent } from '../db/idempotency.js';
import type { AutoReviewQueue } from './auto-review-queue.js';
import { outcome, help, seconds } from './attempt-model.js';
import { recommendation, reviewTargets, updateTarget } from './review-schedule.js';
export function registerCloseout(
  app: FastifyInstance,
  db: Db,
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
      db,
      `finish:${req.params.id}`,
      req.headers['idempotency-key'],
      b,
      () => {
        const a = getAttempt(db, req.params.id);
        checkVersion(a, b.version);
        if (a.status === 'completed') throw conflict('Attempt already completed');
        const { reviewDate: _date, reviewAction: _action, requestReview: _review, ...answer } = b;
        const r = recommendation({ ...a, ...answer });
        const choice = { action: b.reviewAction ?? 'recommended', date: b.reviewDate };
        const reviewOf = a.planItemId ? getItem(db, a.planItemId).reviewOf : null;
        let target;
        if (reviewOf) {
          // A check of an earlier problem's idea: that idea's schedule moves on, and this
          // problem gets none of its own. Two solo solves two weeks apart retire the idea.
          const [idea] = reviewTargets(db, 'WHERE r.problemId = ?', reviewOf);
          // A hand-set date that came due has been served by this check: back to the schedule.
          if (idea && ['manual', 'snooze'].includes(idea.action) && choice.action === 'recommended')
            update(db, 'review_targets', idea.id, { action: 'recommended' });
          target =
            idea?.stage === 'mixed' && r.stage === 'mixed' && choice.action === 'recommended'
              ? updateTarget(db, reviewOf, null, 'retired', { action: 'none' })
              : updateTarget(db, reviewOf, r.date, r.stage, choice);
          updateTarget(db, a.problemId, null, 'covered', { action: 'none' });
        } else target = updateTarget(db, a.problemId, r.date, r.stage, choice);
        update(db, 'attempts', a.id, {
          ...answer,
          version: a.version + 1,
          status: 'completed',
          finishedAt: clock().toISOString(),
          runningSince: null,
          needsGapDecision: false,
          gapSeconds: 0,
          nextReviewDate: target.effectiveDate,
        });
        update(db, 'problems', a.problemId, { exposed: true });
        const done = getAttempt(db, a.id);
        completeAssignment(db, done);
        applyAutoScore(db, done, clock);
        return attemptView(done);
      },
    );
    if (b.requestReview) reviews?.request(req.params.id);
    return result;
  });
  app.get('/api/reviews', () => reviewTargets(db));
  app.patch<{ Params: { id: string } }>('/api/reviews/:id', (req) => {
    const b = z
      .object({
        version,
        action: z.enum(['manual', 'snooze', 'none', 'recommended']),
        date: date.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const [t] = reviewTargets(db, 'WHERE r.id = ?', req.params.id);
      if (!t) throw missing();
      checkVersion(t, b.version);
      if (['manual', 'snooze'].includes(b.action) && !b.date)
        throw new ApiError(400, 'VALIDATION', 'A date is required');
      update(db, 'review_targets', t.id, {
        action: b.action,
        effectiveDate:
          b.action === 'none' ? null : b.action === 'recommended' ? t.recommendedDate : b.date!,
        version: t.version + 1,
      });
      return reviewTargets(db, 'WHERE r.id = ?', t.id)[0];
    });
  });
}
