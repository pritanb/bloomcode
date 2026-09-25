import { consolidatePatternTables } from '../shared/pattern-migration.js';
import type { Store } from './store.js';

/** Idempotent upgrade of the former standalone notebook; preserves assignments, notes and explicit classifications. */
export function migratePatternNotebooks(s: Store) {
  if (!s.all('patterns').length) return;
  s.transaction(() => {
    const tables = consolidatePatternTables({
      tags: s.all('tags'),
      problem_tags: s.all('problem_tags'),
      patterns: s.all('patterns'),
      topics: s.all('topics'),
      import_batches: s.all('import_batches'),
    });
    for (const tag of tables.tags!) s.put('tags', tag as { id: string });
    for (const link of tables.problem_tags!) s.put('problem_tags', link as { id: string });
    for (const old of s.all('patterns')) s.remove('patterns', old.id);
  });
}
