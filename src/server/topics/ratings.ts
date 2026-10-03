// Problem difficulty on one Elo-like scale. Exact ratings come from zerotrac's
// contest data (pinned snapshot); every other problem uses a fitted estimate,
// or the contest median for its difficulty label until the problem bank is fitted.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Db, many } from '../db/db.js';
import { repoRoot } from '../paths.js';

export const RATINGS_REVISION = '8c7a54008482a8b7464bedfb8ca2f3ea172aa0df';
export const RATINGS_SHA256 = 'c0da4136769e9f86e8faaccc5b710430a34075a7525c08783afaf8c572f3c58d';
/** Median contest rating per LeetCode label, measured on the pinned snapshot. */
export const DIFFICULTY_MEDIANS: Record<string, number> = { Easy: 1252, Medium: 1648, Hard: 2262 };

export interface Rating {
  value: number;
  estimated: boolean;
}

let exact: Map<string, number> | undefined;
/** Slug → contest rating. The file is checked against its pinned checksum once. */
export function contestRatings(): Map<string, number> {
  if (exact) return exact;
  const raw = readFileSync(
    new URL('src/integrations/manifests/zerotrac-ratings.txt', repoRoot),
    'utf8',
  );
  if (createHash('sha256').update(raw).digest('hex') !== RATINGS_SHA256)
    throw Error('Bundled problem ratings do not match their pinned checksum.');
  exact = new Map(
    raw
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const cols = line.split('\t');
        return [cols[4]!, Math.round(Number(cols[0]))] as const;
      }),
  );
  return exact;
}

const estimates = new WeakMap<Db, Map<string, number>>();
function fitted(db: Db) {
  let map = estimates.get(db);
  if (!map) {
    map = new Map(
      many<{ slug: string; rating: number }>(db, 'SELECT slug, rating FROM rating_estimates').map(
        (r) => [r.slug, r.rating],
      ),
    );
    estimates.set(db, map);
  }
  return map;
}
const popularity = new WeakMap<Db, Map<string, number>>();
/** Interview popularity: likes percentile among algorithm problems (0–100), if fetched. */
export function problemPopularity(db: Db, slug: string): number | null {
  let map = popularity.get(db);
  if (!map) {
    map = new Map(
      many<{ slug: string; percentile: number }>(
        db,
        'SELECT slug, percentile FROM problem_popularity',
      ).map((r) => [r.slug, r.percentile]),
    );
    popularity.set(db, map);
  }
  return map.get(slug) ?? null;
}
/** Call after rating_estimates or problem_popularity changes. */
export function forgetEstimates(db: Db) {
  estimates.delete(db);
  popularity.delete(db);
}

export function problemRating(
  db: Db,
  p: { slug: string; difficulty: string | null },
): Rating | null {
  const known = contestRatings().get(p.slug);
  if (known !== undefined) return { value: known, estimated: false };
  const estimate = fitted(db).get(p.slug) ?? (p.difficulty && DIFFICULTY_MEDIANS[p.difficulty]);
  return estimate ? { value: Math.round(estimate), estimated: true } : null;
}
