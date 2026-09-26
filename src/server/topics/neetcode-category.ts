import publicLists from '../../integrations/manifests/neetcode-problems.json';
import type { Problem } from '../../shared/contracts.js';

/**
 * A question's curriculum grouping comes from NeetCode's own categories, not
 * from the user's tags. Tags label what a question involves (BFS, prefix sum);
 * topics are the scored curriculum buckets. Keeping these separate means
 * relabelling a question can never move a topic score.
 *
 * Categories come from the pinned MIT NeetCode 150 rows (Blind 75 is a subset),
 * in source order. Other questions fall back to their tags.
 */
const rows = publicLists.filter((row) => row.neetcode150);
export const neetcodeSourceRows = new Map(
  rows.map((row, index) => [row.link.replace(/\/$/, ''), { topic: row.pattern, index }]),
);
export const neetcodeCategories = [...new Set(rows.map((row) => row.pattern))];
export function neetcodeCategory(p: Pick<Problem, 'slug'>): string | null {
  return neetcodeSourceRows.get(p.slug)?.topic ?? null;
}
