// What a tutor reads to review one attempt: the attempt, earlier attempts at the
// same problem and current topic scores. Shared by the review route and the Codex worker.
import type { Topic } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
import { ApiError } from '../db/errors.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { topicView } from '../topics/topic-model.js';
import { type AttemptRecord, attemptView } from './attempt-model.js';
export function attemptContext(s: Store, attemptId: string) {
  assertMetadataVisible(s);
  const a = s.get<AttemptRecord>('attempts', attemptId);
  if (a.context === 'mixed' && a.status !== 'completed')
    throw new ApiError(
      403,
      'HIDDEN_ASSESSMENT',
      'Complete the mixed assessment before requesting history',
    );
  return {
    attempt: attemptView(a),
    history: s
      .all<AttemptRecord>('attempts')
      .filter((x) => x.problemId === a.problemId && x.id !== a.id)
      .map(attemptView),
    topics: s.all<Topic>('topics').map((t) => topicView(s, t)),
  };
}
export type AttemptContext = ReturnType<typeof attemptContext>;
