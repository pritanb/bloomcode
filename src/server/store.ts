import { newTagHue } from './tag-colour.js';
import type Database from 'better-sqlite3';
import { durableTables, type Table } from './db.js';
import { missing } from './errors.js';
export type Entity = { id: string };
export const references: Partial<Record<Table, Record<string, string>>> = {
  plan_items: { plan_id: 'planId', problem_id: 'problemId', attempt_id: 'attemptId' },
  score_decisions: { topic_id: 'topicId', attempt_id: 'attemptId' },
  attempt_topics: { topic_id: 'topicId', attempt_id: 'attemptId' },
  import_records: { import_id: 'importId' },
  import_plans: { import_id: 'importId', problem_id: 'problemId' },
  review_targets: { problem_id: 'problemId' },
  answer_versions: { attempt_id: 'attemptId' },
  attempts: { problem_id: 'problemId' },
  problem_tags: { problem_id: 'problemId', tag_id: 'tagId' },
  list_memberships: { problem_id: 'problemId', list_id: 'listId' },
};
/** All SQL identifiers originate from this fixed allowlist, never request keys. */
export class Store {
  constructor(public sql: Database.Database) {}
  all<T extends Entity>(table: Table): T[] {
    return (
      this.sql.prepare(`SELECT data FROM "${table}" ORDER BY rowid`).all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as T);
  }
  get<T extends Entity>(table: Table, id: string): T {
    const row = this.sql.prepare(`SELECT data FROM "${table}" WHERE id=?`).get(id) as
      { data: string } | undefined;
    if (!row) throw missing();
    return JSON.parse(row.data) as T;
  }
  put<T extends Entity>(table: Table, value: T): T {
    if (!durableTables.includes(table)) throw new Error('Unknown table');
    if (table === 'tags') {
      const tag = value as T & { hue?: number };
      if (tag.hue === undefined) {
        const existing = this.all<Entity & { hue?: number }>('tags');
        value = {
          ...value,
          hue:
            existing.find((row) => row.id === value.id)?.hue ??
            newTagHue(existing.flatMap((row) => (row.hue === undefined ? [] : [row.hue]))),
        };
      }
    }
    const refs = references[table] ?? {},
      columns = ['id', 'data', ...Object.keys(refs)];
    const data = value as unknown as Record<string, unknown>;
    this.sql
      .prepare(
        `INSERT INTO "${table}" (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
          .slice(1)
          .map((c) => `${c}=excluded.${c}`)
          .join(',')}`,
      )
      .run(value.id, JSON.stringify(value), ...Object.values(refs).map((k) => data[k] ?? null));
    return value;
  }
  remove(table: Table, id: string) {
    this.sql.prepare(`DELETE FROM "${table}" WHERE id=?`).run(id);
  }
  transaction<T>(fn: () => T): T {
    return this.sql.transaction(fn).immediate();
  }
}
