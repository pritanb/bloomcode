import { expect, it } from 'vitest';
import type { ScoreDecision } from '../../src/shared/contracts';
import { topicHistory } from '../../src/web/topic-history';
const decision = (
  id: string,
  date: string,
  score: number,
  recordedAt = `${date}T12:00:00Z`,
): ScoreDecision => ({
  id,
  date,
  recordedAt,
  newScore: score,
  oldScore: 2,
  topicId: 'topic',
  topicName: 'Trees',
  attemptId: null,
  rationale: 'Review',
  evidence: 'unseen',
});
it('plots dated final scores chronologically while retaining every same-day review', () => {
  const input = [
    decision('latest', '2026-09-12', 3.25),
    decision('same-day-final', '2026-09-01', 3),
    decision('same-day-first', '2026-09-01', 2.5),
    decision('first', '2026-08-01', 2),
  ];
  const { points, ordered } = topicHistory(input);
  expect(points.map((p) => [p.date, p.score])).toEqual([
    ['2026-08-01', 2],
    ['2026-09-01', 3],
    ['2026-09-12', 3.25],
  ]);
  expect(points[0].time).toBe(Date.UTC(2026, 7, 1));
  expect(ordered.map((d) => d.id)).toEqual(['first', 'same-day-first', 'same-day-final', 'latest']);
  expect(input[0].id).toBe('latest');
});
it('does not fabricate history for empty or single-review topics', () => {
  expect(topicHistory([]).points).toEqual([]);
  expect(topicHistory([decision('only', '2026-09-12', 2.75)]).points).toHaveLength(1);
});
