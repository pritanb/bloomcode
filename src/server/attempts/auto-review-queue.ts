import type { AutoReviewStatus } from '../../shared/contracts.js';
import { type AttemptRecord, attempts } from './attempt-model.js';
import type { Db } from '../db/db.js';

// Finished attempts waiting for a tutor-written report; the Codex worker takes
// them one at a time. Deliberately in memory: it is transient work, not study
// data, and a restart only means the learner asks for the report again.
type Job = { status: 'pending' | 'generating' | 'failed'; error: string | null };
export class AutoReviewQueue {
  private jobs = new Map<string, Job>();
  request(attemptId: string) {
    // A replayed finish or a double-click must not restart a report in progress.
    const job = this.jobs.get(attemptId);
    if (job && job.status !== 'failed') return;
    this.jobs.set(attemptId, { status: 'pending', error: null });
  }
  status(a: AttemptRecord): Omit<AutoReviewStatus, 'tutorConnected'> {
    if (a.feedback) {
      this.jobs.delete(a.id);
      return { status: 'done', error: null };
    }
    const job = this.jobs.get(a.id);
    return { status: job?.status ?? 'none', error: job?.error ?? null };
  }
  /** The next attempt still needing a report, now marked as generating. */
  take(db: Db): AttemptRecord | null {
    for (const [attemptId, job] of this.jobs) {
      if (job.status !== 'pending') continue;
      const [a] = attempts(db, 'WHERE a.id = ?', attemptId);
      if (!a || a.feedback) {
        this.jobs.delete(attemptId);
        continue;
      }
      this.jobs.set(attemptId, { status: 'generating', error: null });
      return a;
    }
    return null;
  }
  done(attemptId: string) {
    this.jobs.delete(attemptId);
  }
  fail(attemptId: string, message: string) {
    if (this.jobs.has(attemptId)) this.jobs.set(attemptId, { status: 'failed', error: message });
  }
}
