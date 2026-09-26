import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema.js';
import { repoRoot } from '../paths.js';
export const durableTables = [
  'settings',
  'problems',
  'tags',
  'lists',
  'problem_tags',
  'list_memberships',
  'attempts',
  'review_targets',
  'answer_versions',
  'audit_events',
  'topics',
  'score_decisions',
  'attempt_topics',
  'import_batches',
  'import_records',
  'daily_plans',
  'plan_items',
  'learning_insights',
] as const;
export type Table = (typeof durableTables)[number];
/** Save a copy before pending migrations change an existing database. Daily backup
 * pruning leaves these files alone. */
function backupBeforeMigrating(sqlite: Database.Database, path: string, folder: string) {
  const applied = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get()
    ? (sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n
    : 0;
  const { entries } = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  if (applied === 0 || applied >= entries.length) return; // new database, or up to date
  const backups = join(dirname(path), 'backups');
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const copy = join(
    backups,
    `before-migration-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
  );
  sqlite.prepare('VACUUM INTO ?').run(copy);
  chmodSync(copy, 0o600);
}
export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const orm = drizzle(sqlite, { schema });
  const migrationsFolder = fileURLToPath(new URL('drizzle/', repoRoot));
  if (path !== ':memory:') backupBeforeMigrating(sqlite, path, migrationsFolder);
  migrate(orm, { migrationsFolder });
  if (!orm.select().from(schema.settings).get())
    orm
      .insert(schema.settings)
      .values({
        id: 'singleton',
        data: {
          onboardingComplete: false,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          budgetMinutes: 40,
          primaryCount: 1,
          optionalCount: 1,
          lastBackupAt: null,
        },
      })
      .run();
  return { sqlite, orm };
}
