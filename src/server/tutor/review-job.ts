import { type Db, transaction } from '../db/db.js';
import { getAttempt } from '../attempts/attempt-model.js';
import type { AutoReviewQueue } from '../attempts/auto-review-queue.js';
import { attemptContext } from '../attempts/attempt-context.js';
import { saveReview } from '../scoring/review-model.js';
import type { Generate } from './generate.js';

/** Write the report for the next queued attempt. Returns whether there was one. */
export async function reviewNext(
  { db, clock, reviews }: { db: Db; clock: () => Date; reviews: AutoReviewQueue },
  generate: Generate,
): Promise<boolean> {
  const next = reviews.take(db);
  if (!next) return false;
  try {
    const feedback = (
      await generate({
        kind: 'review',
        context: attemptContext(db, next.id),
        timeoutMs: 180_000,
      })
    ).text.trim();
    if (!feedback) throw new Error('The tutor returned an empty report.');
    // Re-read the version: the learner may have saved a reflection meanwhile.
    transaction(db, () => {
      const a = getAttempt(db, next.id);
      if (!a.feedback) saveReview(db, clock, a.id, { version: a.version, feedback, decisions: [] });
    });
    reviews.done(next.id);
  } catch (error) {
    reviews.fail(
      next.id,
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : 'The tutor could not write this report.',
    );
  }
  return true;
}
