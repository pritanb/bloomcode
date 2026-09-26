import type { FastifyInstance } from 'fastify';
import type { AttemptRecord } from './attempt-model.js';
import type { AutoReviewQueue } from './auto-review-queue.js';
import { conflict } from '../db/errors.js';
import type { Store } from '../db/store.js';

export function registerAutoReview(
  app: FastifyInstance,
  s: Store,
  queue: AutoReviewQueue,
  tutorActive: () => boolean,
) {
  const status = (a: AttemptRecord) => ({ ...queue.status(a), tutorConnected: tutorActive() });
  app.get<{ Params: { id: string } }>('/api/attempts/:id/auto-review', (req) =>
    status(s.get<AttemptRecord>('attempts', req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/attempts/:id/auto-review', (req) => {
    const a = s.get<AttemptRecord>('attempts', req.params.id);
    if (a.status !== 'completed') throw conflict('Finish the attempt before requesting a review');
    if (!a.feedback) queue.request(a.id);
    return status(a);
  });
}
