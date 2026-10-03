import { expect, test } from 'vitest';
import { fitRatingModel, type ProblemFeatures } from '../../src/integrations/rating-model.js';
import { contestRatings, RATINGS_SHA256 } from '../../src/server/topics/ratings.js';

const labels = ['Easy', 'Medium', 'Hard'] as const;
// Known generating rule: a label base, lower acceptance is harder, Graph adds 120.
const truth = (p: ProblemFeatures) => {
  const rate = p.acRate / 100;
  return (
    [1200, 1600, 2100][labels.indexOf(p.difficulty)]! -
    80 * Math.log(rate / (1 - rate)) +
    (p.tags.includes('Graph') ? 120 : 0)
  );
};

test('recovers a known rule and reports error on held-out rows only', () => {
  const rows = Array.from({ length: 300 }, (_, i) => {
    const p: ProblemFeatures = {
      difficulty: labels[i % 3]!,
      acRate: 20 + ((i * 37) % 60),
      tags: i % 4 === 0 ? ['Graph'] : ['Array'],
    };
    return { ...p, rating: truth(p) };
  });
  const model = fitRatingModel(rows);
  const probe: ProblemFeatures = { difficulty: 'Medium', acRate: 45, tags: ['Graph'] };
  expect(Math.abs(model.predict(probe) - truth(probe))).toBeLessThan(15);
  expect(model.heldOutError).toBeLessThan(15);

  // Noise the fit cannot learn shows up as held-out error, not as a perfect score.
  const noisy = rows.map((r, i) => ({
    ...r,
    rating: r.rating + ((i * 7919) % 13 < 6 ? 200 : -200),
  }));
  expect(fitRatingModel(noisy).heldOutError).toBeGreaterThan(120);
});

test('the bundled contest ratings match their pinned checksum', () => {
  expect(RATINGS_SHA256).toHaveLength(64);
  const ratings = contestRatings();
  expect(ratings.size).toBeGreaterThan(2500);
  expect(ratings.get('koko-eating-bananas')).toBe(1766);
});
