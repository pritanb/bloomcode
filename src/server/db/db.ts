import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { missing } from './errors.js';
import { SCHEMA } from './schema.js';

export type Db = Database.Database;
type Param = string | number | bigint | null | Buffer;
export type Table =
  | 'settings'
  | 'problems'
  | 'tags'
  | 'lists'
  | 'problem_tags'
  | 'list_memberships'
  | 'attempts'
  | 'review_targets'
  | 'topics'
  | 'score_decisions'
  | 'attempt_topics'
  | 'import_batches'
  | 'import_records'
  | 'daily_plans'
  | 'plan_items'
  | 'learning_insights';

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  // A non-zero user_version marks a database whose tables already exist.
  if (!db.pragma('user_version', { simple: true }))
    db.transaction(() => {
      db.exec(SCHEMA);
      db.pragma('user_version = 6');
    })();
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, timezone, budgetMinutes, primaryCount, optionalCount, onboardingComplete)
     VALUES (1, ?, 40, 1, 1, 0)`,
  ).run(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  return db;
}

/** The single row a query must find; a missing row is a 404. */
export function one<T>(db: Db, sql: string, ...params: Param[]): T {
  const row = db.prepare(sql).get(...params) as T | undefined;
  if (row === undefined) throw missing();
  return row;
}
export function maybe<T>(db: Db, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function many<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(db: Db, sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}
export function transaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}

// SQLite stores booleans as 0/1 and lists as JSON text.
function column(value: unknown): Param {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value))
    return JSON.stringify(value);
  return value as Param;
}
/** Insert a row whose keys are the table's column names. */
export function insert<T extends object>(db: Db, table: Table, row: T): T {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
  ).run(...keys.map((k) => column((row as Record<string, unknown>)[k])));
  return row;
}
/** Update the named columns of the row with this id. */
export function update(db: Db, table: Table, id: string | number, fields: object) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => column((fields as Record<string, unknown>)[k])),
    id,
  );
}
