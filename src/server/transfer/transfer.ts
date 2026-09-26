import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Snapshot, Settings } from '../../shared/contracts.js';
import { durableTables } from '../db/db.js';
import { Store } from '../db/store.js';

// A read-only table dump (used to verify imports) and native SQLite backups.
// To restore a backup, stop the app and copy the .sqlite file back as the database.
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
) {
  app.get('/api/export', () => exportSnapshot(s, clock));
  app.post('/api/backup', async (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
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
    return { path, createdAt };
  });
}
