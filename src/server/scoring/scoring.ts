import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Store } from '../db/store.js';
import { date } from '../catalogue/problem-model.js';
import { version } from '../attempts/attempt-model.js';
import { idempotent } from '../db/idempotency.js';
import { score } from '../catalogue/import.js';
import { saveReview } from './review-model.js';
export function registerScoring(app: FastifyInstance, s: Store, clock: () => Date) {
  app.post<{ Params: { id: string } }>('/api/attempts/:id/reviews', (req) => {
    const b = z
      .object({
        version,
        feedback: z.string().min(1).max(100000),
        decisions: z
          .array(
            z
              .object({
                topicId: z.string(),
                expectedVersion: version,
                oldScore: score,
                newScore: score,
                rationale: z.string().min(1).max(20000),
                evidence: z.enum(['retention', 'near_transfer', 'unseen', 'mock']),
              })
              .strict(),
          )
          .max(100)
          .optional()
          .default([]),
        followUp: z
          .object({ date: date.nullable(), action: z.enum(['recommended', 'manual', 'none']) })
          .strict()
          .optional(),
      })
      .strict()
      .parse(req.body);
    return idempotent(s, `review:${req.params.id}`, req.headers['idempotency-key'], b, () =>
      saveReview(s, clock, req.params.id, b),
    );
  });
}
