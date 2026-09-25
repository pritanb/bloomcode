import manifest from '../integrations/manifests/neetcode250.json';
import type { Problem } from '../shared/contracts.js';

/**
 * A question's curriculum grouping comes from NeetCode's own categories, not
 * from the user's tags. Tags label what a question involves (BFS, prefix sum);
 * topics are the scored curriculum buckets. Keeping these separate means
 * relabelling a question can never move a topic score.
 */
const categoryBySlug = new Map(
  manifest.problems.map((row) => [row.link.replace(/\/$/, ''), row.pattern]),
);
export const neetcodeCategories = [...new Set(manifest.problems.map((row) => row.pattern))];
export function neetcodeCategory(p: Pick<Problem, 'slug'>): string | null {
  return categoryBySlug.get(p.slug) ?? null;
}
