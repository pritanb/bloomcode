import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { chmodSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoRoot } from '../paths.js';
import { missing } from './errors.js';

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
  migrate(db, path);
  db.pragma('foreign_keys = ON');
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, timezone, budgetMinutes, primaryCount, optionalCount, onboardingComplete)
     VALUES (1, ?, 40, 1, 1, 0)`,
  ).run(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  return db;
}

/**
 * Runs each numbered .sql file in migrations/ once, in order. SQLite's user_version
 * holds the number of the last file applied. Before migrating an existing database it
 * saves a copy to backups/, which daily backup pruning leaves alone.
 */
function migrate(db: Db, path: string) {
  const folder = fileURLToPath(new URL('migrations/', repoRoot));
  const applied = db.pragma('user_version', { simple: true }) as number;
  const pending = readdirSync(folder)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) > applied)
    .sort();
  if (!pending.length) return;
  if (applied > 0 && path !== ':memory:') {
    const backups = join(dirname(path), 'backups');
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const copy = join(
      backups,
      `before-migration-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
    );
    db.prepare('VACUUM INTO ?').run(copy);
    chmodSync(copy, 0o600);
  }
  // Rebuilding a table needs foreign keys off; they are checked once all files have run.
  db.pragma('foreign_keys = OFF');
  for (const file of pending)
    db.transaction(() => {
      db.exec(readFileSync(join(folder, file), 'utf8'));
      db.pragma(`user_version = ${Number(file.slice(0, 4))}`);
    })();
  const broken = db.pragma('foreign_key_check') as unknown[];
  if (broken.length) throw new Error(`Migration left ${broken.length} broken references`);
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
