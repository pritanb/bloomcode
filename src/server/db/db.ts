import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
  'import_plans',
  'daily_plans',
  'plan_items',
  'patterns',
  'learning_insights',
] as const;
export type Table = (typeof durableTables)[number];
export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new Database(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const orm = drizzle(sqlite, { schema });
  migrate(orm, { migrationsFolder: fileURLToPath(new URL('drizzle/', repoRoot)) });
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
          dataMode: 'local',
          lastBackupAt: null,
        },
      })
      .run();
  return { sqlite, orm };
}
