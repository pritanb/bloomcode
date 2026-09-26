import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Snapshot, Settings } from '../../shared/contracts.js';
import { durableTables } from '../db/db.js';
import { Store } from '../db/store.js';

// A read-only table dump (used to verify imports) and native SQLite backups,
// taken daily at startup and on demand. To restore, stop the app and copy a
// backup file back as the database.
export function exportSnapshot(s: Store, clock: () => Date): Snapshot {
  return s.transaction(() => ({
    schemaVersion: 4,
    exportedAt: clock().toISOString(),
    tables: Object.fromEntries(
      durableTables.map((t) => [
        t,
        (
          s.sql.prepare(`SELECT id,data FROM "${t}" ORDER BY rowid`).all() as {
            id: string;
            data: string;
          }[]
        ).map((r) => ({ ...JSON.parse(r.data), id: r.id })),
      ]),
    ),
  }));
}
export function registerTransfer(
  app: FastifyInstance,
  s: Store,
  clock: () => Date,
  dbPath: string,
  dailyBackup = false,
) {
  if (dailyBackup)
    app.addHook('onReady', async () => {
      await backupIfDue(s, clock, dbPath).catch((error: unknown) =>
        console.error('Automatic backup failed:', error),
      );
    });
  app.get('/api/export', () => exportSnapshot(s, clock));
  app.post('/api/backup', async (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return backupNow(s, clock, dbPath);
  });
}
const KEEP_BACKUPS = 7;
/** Copy the database into the private backups folder, keeping the newest seven copies. */
export async function backupNow(s: Store, clock: () => Date, dbPath: string) {
  const folder = join(dirname(dbPath), 'backups');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const createdAt = clock().toISOString(),
    path = join(folder, `leetcode-${createdAt.replaceAll(':', '-')}-${randomUUID()}.sqlite`);
  await s.sql.backup(path);
  chmodSync(path, 0o600);
  const settings = s.get<Settings & { id: string }>('settings', 'singleton');
  s.sql
    .prepare('UPDATE settings SET data=? WHERE id=?')
    .run(JSON.stringify({ ...settings, lastBackupAt: createdAt }), 'singleton');
  // Names start with the ISO time, so sorting them sorts by age.
  const backups = readdirSync(folder)
    .filter((f) => /^leetcode-.*\.sqlite$/.test(f))
    .sort();
  for (const old of backups.slice(0, -KEEP_BACKUPS)) rmSync(join(folder, old));
  return { path, createdAt };
}
/** Back up at startup when the last backup is over a day old. */
export async function backupIfDue(s: Store, clock: () => Date, dbPath: string) {
  const { lastBackupAt } = s.get<Settings & { id: string }>('settings', 'singleton');
  if (lastBackupAt && clock().getTime() - Date.parse(lastBackupAt) < 24 * 60 * 60 * 1000) return;
  await backupNow(s, clock, dbPath);
}
