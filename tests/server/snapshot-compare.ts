import { isDeepStrictEqual } from 'node:util';
import { consolidatePatternTables } from '../../src/shared/pattern-migration.js';
import { snapshotSchema } from '../../src/integrations/snapshot.js';

// Compares two table dumps ignoring row order, after the pattern-notebook
// consolidation the app applies to legacy data on startup.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function sameTables(a: unknown, b: unknown): boolean {
  const first = snapshotSchema.parse(a),
    second = snapshotSchema.parse(b);
  const order = (tables: typeof first.tables) =>
    Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [
        name,
        rows.map((r) => JSON.stringify(canonical(r))).sort(),
      ]),
    );
  const normalize = (snapshot: typeof first) =>
    consolidatePatternTables({
      ...snapshot.tables,
      learning_insights: (snapshot.tables.learning_insights ?? []).map((r) =>
        (r.kind === 'job' || r.kind === 'topic_analysis') && r.status === 'running'
          ? { ...r, status: 'pending', claimId: null, claimedAt: 0 }
          : r,
      ),
    });
  return isDeepStrictEqual(order(normalize(first)), order(normalize(second)));
}
