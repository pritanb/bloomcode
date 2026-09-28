import { expect, it } from 'vitest';
import { patternCandidates } from '../../src/server/insights/patterns.js';
import type { Observation } from '../../src/shared/insights.js';
const observation = (
  id: string,
  problemId: string,
  polarity: Observation['polarity'] = 'difficulty',
): Observation => ({
  id,
  problemId,
  attemptId: `attempt-${id}`,
  polarity,
  summary: `Unique observation ${id}`,
  sourceField: 'notes',
  excerpt: id,
  evidenceType: 'learner_reported',
  kind: 'observation',
  fingerprint: id,
  analysisVersion: 'test',
  createdAt: '2020-01-01',
  model: null,
});
it('groups semantically related observations across the corpus and retains counterevidence', () => {
  const rows = [
    observation('a', 'binary'),
    observation('b', 'insert'),
    observation('c', 'minimum', 'strength'),
    observation('d', 'tree'),
  ];
  const vectors = new Map([
    ['a', [1, 0]],
    ['b', [0.99, 0.01]],
    ['c', [0.98, 0.02]],
    ['d', [0, 1]],
  ]);
  const groups = patternCandidates(rows, vectors);
  expect(groups).toHaveLength(2);
  expect(groups[0].requiredEvidenceIds).toEqual(['a', 'b', 'c']);
  expect(groups[0].evidenceIds).not.toContain('d');
  expect(patternCandidates([...rows].reverse(), vectors)).toEqual(groups);
});
it('repeated observations on one problem do not outrank a pattern across problems', () => {
  const rows = [
    observation('x', 'one'),
    observation('y', 'two'),
    ...Array.from({ length: 20 }, (_, i) => observation(`repeat-${i}`, 'same')),
  ];
  const vectors = new Map(
    rows.map((row) => [row.id, row.id.startsWith('repeat') ? [0, 1] : [1, 0]]),
  );
  expect(patternCandidates(rows, vectors)[0].requiredEvidenceIds).toEqual(['x', 'y']);
});
it('does not treat nearest neighbours with no similarity as a pattern', () => {
  const a = { ...observation('a', 'a'), summary: 'Binary search interval boundary' },
    b = { ...observation('b', 'b'), summary: 'Tree traversal recursive base case' };
  expect(patternCandidates([a, b], new Map())).toHaveLength(2);
});
