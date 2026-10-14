import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { missing } from './errors.js';
import { newTagHue } from './tag-colour.js';
import {
  SCHEMA,
  GOAL_SCHEMA,
  PREFERENCE_SCHEMA,
  PLAN_DRAFT_SCHEMA,
  TUTOR_NOTE_SCHEMA,
} from './schema.js';

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
  | 'plan_drafts'
  | 'rating_estimates'
  | 'problem_popularity'
  | 'attempt_signals'
  | 'insight_jobs'
  | 'insight_observations'
  | 'insight_corrections'
  | 'insight_reports'
  | 'topic_analysis';

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  // A non-zero user_version marks a database whose tables already exist.
  const version = db.pragma('user_version', { simple: true });
  if (!version)
    db.transaction(() => {
      db.exec(SCHEMA + PLAN_DRAFT_SCHEMA + TUTOR_NOTE_SCHEMA);
      db.pragma('user_version = 13');
    })();
  // One-off: version 7 kept unused minute budgets. Delete once the live database is at 8.
  else if (version === 7)
    db.transaction(() => {
      db.exec(`ALTER TABLE settings DROP COLUMN budgetMinutes;
        ALTER TABLE plan_items DROP COLUMN suggestedMinutes;`);
      db.pragma('user_version = 8');
    })();
  if (db.pragma('user_version', { simple: true }) === 8)
    db.transaction(() => {
      db.exec(GOAL_SCHEMA);
      db.pragma('user_version = 9');
    })();
  if (db.pragma('user_version', { simple: true }) === 9)
    db.transaction(() => {
      db.exec(PREFERENCE_SCHEMA);
      db.pragma('user_version = 10');
    })();
  if (db.pragma('user_version', { simple: true }) === 10)
    db.transaction(() => {
      db.exec(PLAN_DRAFT_SCHEMA);
      db.exec('ALTER TABLE plan_items ADD COLUMN reviewOf TEXT REFERENCES problems (id)');
      db.pragma('user_version = 11');
    })();
  if (db.pragma('user_version', { simple: true }) === 11)
    db.transaction(() => {
      db.exec(TUTOR_NOTE_SCHEMA);
      db.pragma('user_version = 12');
    })();
  // One-off: the bank once filed Trie + DP problems under Tries. Delete once the live database is at 13.
  if (db.pragma('user_version', { simple: true }) === 12)
    db.transaction(() => {
      retagTrieDp(db);
      db.pragma('user_version = 13');
    })();
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, timezone, primaryCount, optionalCount, onboardingComplete)
     VALUES (1, ?, 1, 1, 0)`,
  ).run(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  return db;
}

/** Move downloaded bank problems LeetCode tags Trie and DP from Tries to their DP topic. */
function retagTrieDp(db: Db) {
  const moves = db
    .prepare(
      `SELECT p.id, pt.tagId AS tries,
        CASE WHEN EXISTS (SELECT 1 FROM json_each(p.leetcodeTopics) WHERE value = 'Matrix')
          THEN '2-D Dynamic Programming' ELSE '1-D Dynamic Programming' END AS category
      FROM problems p
      JOIN problem_tags pt ON pt.problemId = p.id
      JOIN tags t ON t.id = pt.tagId AND t.name = 'Tries'
      WHERE EXISTS (SELECT 1 FROM json_each(p.leetcodeTopics) WHERE value = 'Trie')
        AND EXISTS (SELECT 1 FROM json_each(p.leetcodeTopics) WHERE value = 'Dynamic Programming')
        AND EXISTS (SELECT 1 FROM list_memberships m JOIN lists l ON l.id = m.listId
          WHERE m.problemId = p.id AND l.name = 'LeetCode problem bank')`,
    )
    .all() as { id: string; tries: string; category: string }[];
  for (const move of moves) {
    let tag = (
      db.prepare('SELECT id FROM tags WHERE lower(name) = lower(?)').get(move.category) as
        { id: string } | undefined
    )?.id;
    if (!tag) {
      const hues = db.prepare('SELECT hue FROM tags WHERE hue IS NOT NULL').all() as {
        hue: number;
      }[];
      tag = randomUUID();
      db.prepare('INSERT INTO tags (id, name, hue) VALUES (?, ?, ?)').run(
        tag,
        move.category,
        newTagHue(hues.map((h) => h.hue)),
      );
    }
    db.prepare('DELETE FROM problem_tags WHERE problemId = ? AND tagId = ?').run(
      move.id,
      move.tries,
    );
    db.prepare('INSERT OR IGNORE INTO problem_tags (problemId, tagId) VALUES (?, ?)').run(
      move.id,
      tag,
    );
  }
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
/** Insert a row, or overwrite the columns it names in the row with the same id. */
export function upsert<T extends object>(db: Db, table: Table, row: T): T {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${keys.map((k) => `"${k}" = excluded."${k}"`).join(', ')}`,
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
