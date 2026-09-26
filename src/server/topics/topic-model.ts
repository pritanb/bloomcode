// Topic scores and score decisions as the API shows them.
import type { ScoreDecision, Topic } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
export interface AttemptTopic {
  id: string;
  attemptId: string;
  topicId: string;
}
export function decisionView(
  d: ScoreDecision & { sourceKey?: string; importId?: string; supersedesId?: string | null },
): ScoreDecision {
  const { sourceKey: _source, importId: _import, supersedesId: _supersedes, ...publicDecision } = d;
  return publicDecision;
}
export function topicView(s: Store, t: Topic): Topic {
  const decisions = s
    .all<ScoreDecision>('score_decisions')
    .filter((d) => d.topicId === t.id)
    .reverse()
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt));
  return { ...t, lastMovement: decisions[0] ? decisionView(decisions[0]) : null };
}
