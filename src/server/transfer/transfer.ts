import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { readSettings, writeSettings } from '../db/settings.js';

// Native SQLite backups, taken daily at startup and on demand. To restore, stop the
// app and copy a backup file back as the database.
export function registerTransfer(
  app: FastifyInstance,
  db: Db,
  clock: () => Date,
  dbPath: string,
  dailyBackup = false,
) {
  if (dailyBackup)
    app.addHook('onReady', async () => {
      await backupIfDue(db, clock, dbPath).catch((error: unknown) =>
        console.error('Automatic backup failed:', error),
      );
    });
  app.post('/api/backup', async (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return backupNow(db, clock, dbPath);
  });
}
const KEEP_BACKUPS = 7;
/** Copy the database into the private backups folder, keeping the newest seven copies. */
export async function backupNow(db: Db, clock: () => Date, dbPath: string) {
  const folder = join(dirname(dbPath), 'backups');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const createdAt = clock().toISOString(),
    path = join(folder, `leetcode-${createdAt.replaceAll(':', '-')}-${randomUUID()}.sqlite`);
  await db.backup(path);
  chmodSync(path, 0o600);
  writeSettings(db, { lastBackupAt: createdAt });
  // Names start with the ISO time, so sorting them sorts by age.
  const backups = readdirSync(folder)
    .filter((f) => /^leetcode-.*\.sqlite$/.test(f))
    .sort();
  for (const old of backups.slice(0, -KEEP_BACKUPS)) rmSync(join(folder, old));
  return { path, createdAt };
}
/** Back up at startup when the last backup is over a day old. */
export async function backupIfDue(db: Db, clock: () => Date, dbPath: string) {
  const { lastBackupAt } = readSettings(db);
  if (lastBackupAt && clock().getTime() - Date.parse(lastBackupAt) < 24 * 60 * 60 * 1000) return;
  await backupNow(db, clock, dbPath);
}
