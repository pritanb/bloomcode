import { test, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import sheetEvidenceImport from './fixtures/sheet-evidence-import.json';
import type { ImportPayload } from '../../src/shared/contracts.js';
import { applyAndVerify } from '../../src/integrations/import-client.js';
const exec = promisify(execFile);
test('real backend accepts mapped source records, idempotent replay and a complete CLI backup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-real-'));
  const first = join(dir, 'first');
  const a = await createApp({ dbPath: join(first, 'leetcode.sqlite') });
  let recovered: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const url = await a.listen({ port: 0, host: '127.0.0.1' });
    const api = new LocalApi({ dataDir: first, baseUrl: url });
    // Captured from the retired Sheet mapper: a topic rating and one tracked attempt.
    const mapped = { payload: sheetEvidenceImport as ImportPayload };
    expect((await applyAndVerify(api, mapped.payload)).verified).toBe(true);
    expect((await applyAndVerify(api, mapped.payload)).verified).toBe(true);
    const env = { ...process.env, DATA_DIR: first, PORT: new URL(url).port };
    const backup = JSON.parse(
      (await exec(process.execPath, ['--import', 'tsx', 'scripts/backup.ts'], { env })).stdout,
    ) as { path: string; verified: boolean };
    expect(backup.verified).toBe(true);
    // Recovery is opening the backup file as the database.
    recovered = await createApp({ dbPath: backup.path, token: 'recovered' });
    const restored = (
      await recovered.inject({ url: '/api/export', headers: { authorization: 'Bearer recovered' } })
    ).json() as { tables: Record<string, Record<string, unknown>[]> };
    expect(restored.tables.attempts).toHaveLength(1);
    expect(restored.tables.attempts![0]?.code).toBe('print(1)');
    expect(restored.tables.topics![0]?.score).toBe(3.85);
    expect(restored.tables.score_decisions).toHaveLength(1);
  } finally {
    await a.close();
    await recovered?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
