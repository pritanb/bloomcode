// What a tutor reads to review one attempt: the attempt, earlier attempts at the
// same problem and current topic scores. Shared by the review route and the Codex worker.
import type { Db } from '../db/db.js';
import { ApiError } from '../db/errors.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { topics } from '../topics/topic-model.js';
import { attempts, attemptView, getAttempt } from './attempt-model.js';
import { getItem } from '../plans/plan-model.js';
import { maybe } from '../db/db.js';
export function attemptContext(db: Db, attemptId: string) {
  assertMetadataVisible(db);
  const a = getAttempt(db, attemptId);
  if (a.context === 'mixed' && a.status !== 'completed')
    throw new ApiError(
      403,
      'HIDDEN_ASSESSMENT',
      'Complete the mixed assessment before requesting history',
    );
  // A check of an earlier problem's idea: the report links the two.
  const item = a.planItemId ? getItem(db, a.planItemId) : null;
  const earlier = item?.reviewOf
    ? maybe<{ title: string }>(db, 'SELECT title FROM problems WHERE id = ?', item.reviewOf)
    : undefined;
  return {
    ...(earlier && a.status === 'completed'
      ? {
          checkOf: {
            title: earlier.title,
            kind: item!.recommendationKind ? ('practice' as const) : ('transfer' as const),
          },
        }
      : {}),
    attempt: attemptView(a),
    history: attempts(
      db,
      'WHERE a.problemId = ? AND a.id != ? ORDER BY a.rowid',
      a.problemId,
      a.id,
    ).map(attemptView),
    topics: topics(db),
  };
}
export type AttemptContext = ReturnType<typeof attemptContext>;
