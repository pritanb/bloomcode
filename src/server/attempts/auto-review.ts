import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AutoReviewStatus } from '../../shared/contracts.js';
import type { AttemptRecord } from './attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import type { Store } from '../db/store.js';

// Queue of finished attempts waiting for a tutor-written report. The active
// tutor provider (the app's Codex worker, or the MCP adapter via sampling)
// claims each one, then saves it through the normal review endpoint.
// The queue is deliberately in memory: it is transient work, not study data,
// and a restart only means the learner asks for the report again.
const LEASE_MS = 4 * 60_000; // a claim older than this is handed out again
const TUTOR_SEEN_MS = 30_000; // a tutor that polled this recently counts as connected
type Job = {
  status: 'pending' | 'generating' | 'failed';
  claimId: string | null;
  claimedAt: number;
  error: string | null;
};
export class AutoReviewQueue {
  private jobs = new Map<string, Job>();
  private tutorSeenAt = -Infinity;
  constructor(private clock: () => Date) {}
  request(attemptId: string) {
    // A replayed finish or a double-click must not restart a report in progress.
    const job = this.jobs.get(attemptId);
    if (job && job.status !== 'failed') return;
    this.jobs.set(attemptId, { status: 'pending', claimId: null, claimedAt: 0, error: null });
  }
  status(a: AttemptRecord): AutoReviewStatus {
    const tutorConnected = this.clock().getTime() - this.tutorSeenAt < TUTOR_SEEN_MS;
    if (a.feedback) {
      this.jobs.delete(a.id);
      return { status: 'done', error: null, tutorConnected };
    }
    const job = this.jobs.get(a.id);
    return { status: job?.status ?? 'none', error: job?.error ?? null, tutorConnected };
  }
  claim(s: Store): { attemptId: string; claimId: string } | null {
    const now = this.clock().getTime();
    this.tutorSeenAt = now;
    for (const [attemptId, job] of this.jobs) {
      const stale = job.status === 'generating' && now - job.claimedAt > LEASE_MS;
      if (job.status !== 'pending' && !stale) continue;
      let a: AttemptRecord;
      try {
        a = s.get<AttemptRecord>('attempts', attemptId);
      } catch {
        this.jobs.delete(attemptId);
        continue;
      }
      if (a.feedback) {
        this.jobs.delete(attemptId);
        continue;
      }
      const claimId = randomUUID();
      this.jobs.set(attemptId, { status: 'generating', claimId, claimedAt: now, error: null });
      return { attemptId, claimId };
    }
    return null;
  }
  fail(attemptId: string, claimId: string, message: string) {
    const job = this.jobs.get(attemptId);
    if (job?.claimId !== claimId) return; // a newer claim owns this attempt now
    this.jobs.set(attemptId, { ...job, status: 'failed', error: message });
  }
}
const bearerOnly = (req: FastifyRequest) => {
  if (!req.headers.authorization)
    throw new ApiError(403, 'BEARER_REQUIRED', 'Only the tutor adapter may claim reviews');
};
export function registerAutoReview(
  app: FastifyInstance,
  s: Store,
  queue: AutoReviewQueue,
  mayClaim: (req: FastifyRequest) => boolean = () => true,
) {
  app.get<{ Params: { id: string } }>('/api/attempts/:id/auto-review', (req) =>
    queue.status(s.get<AttemptRecord>('attempts', req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/api/attempts/:id/auto-review', (req) => {
    const a = s.get<AttemptRecord>('attempts', req.params.id);
    if (a.status !== 'completed') throw conflict('Finish the attempt before requesting a review');
    if (!a.feedback) queue.request(a.id);
    return queue.status(a);
  });
  app.post('/api/auto-reviews/claim', (req) => {
    bearerOnly(req);
    return { job: mayClaim(req) ? queue.claim(s) : null };
  });
  app.post<{ Params: { id: string } }>('/api/auto-reviews/:id/fail', (req) => {
    bearerOnly(req);
    const b = z
      .object({ claimId: z.string().min(1).max(100), message: z.string().min(1).max(500) })
      .strict()
      .parse(req.body);
    queue.fail(req.params.id, b.claimId, b.message);
    return { ok: true };
  });
}
