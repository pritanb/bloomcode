import { test, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createApp } from '../../src/server/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { mapSheetSnapshot } from '../../src/integrations/sheet.js';
import { applyAndVerify } from '../../src/integrations/import-client.js';
const exec = promisify(execFile);
test('real backend accepts mapped source records, idempotent replay, CLI backup and complete empty-only restore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-real-'));
  const first = join(dir, 'first'),
    second = join(dir, 'second');
  const a = await createApp({ dbPath: join(first, 'leetcode.sqlite') }),
    b = await createApp({ dbPath: join(second, 'leetcode.sqlite') });
  try {
    const url = await a.listen({ port: 0, host: '127.0.0.1' }),
      url2 = await b.listen({ port: 0, host: '127.0.0.1' });
    const api = new LocalApi({ dataDir: first, baseUrl: url });
    const mapped = mapSheetSnapshot({
      retrievedAt: '2026-09-16T00:00:00Z',
      sheets: [
        {
          title: 'Topic Ratings',
          values: [
            ['Topic', 'Rating (1-5)'],
            ['Trees', 3.85],
          ],
        },
        {
          title: 'Tutor Tracker',
          values: [
            [
              'Date',
              'Problem',
              'Link',
              'Result',
              'Time Min',
              'Code',
              'Tutor Rating Change',
              'Tracked Topic(s)',
            ],
            [
              '2026-09-01',
              'Test Tree',
              'https://leetcode.com/problems/test-tree/',
              'Clean',
              '12:34',
              'print(1)',
              'Trees 3.50 -> 3.65',
              'Trees',
            ],
          ],
        },
      ],
    });
    expect((await applyAndVerify(api, mapped.payload)).verified).toBe(true);
    expect((await applyAndVerify(api, mapped.payload)).verified).toBe(true);
    const env = { ...process.env, DATA_DIR: first, PORT: new URL(url).port };
    expect(
      JSON.parse(
        (await exec(process.execPath, ['--import', 'tsx', 'scripts/backup.ts'], { env })).stdout,
      ).verified,
    ).toBe(true);
    const output = join(dir, 'snapshot.json');
    await exec(process.execPath, ['--import', 'tsx', 'scripts/export.ts', '--output', output], {
      env,
    });
    const restore = await exec(
      process.execPath,
      ['--import', 'tsx', 'scripts/restore.ts', '--input', output, '--confirm-empty'],
      { env: { ...env, DATA_DIR: second, PORT: new URL(url2).port } },
    );
    expect(JSON.parse(restore.stdout).verified).toBe(true);
    const restored = (await new LocalApi({ dataDir: second, baseUrl: url2 }).request(
      'GET',
      '/api/export',
    )) as { tables: Record<string, Record<string, unknown>[]> };
    expect(restored.tables.attempts).toHaveLength(1);
    expect(restored.tables.attempts![0]?.code).toBe('print(1)');
    expect(restored.tables.topics![0]?.score).toBe(3.85);
    expect(restored.tables.score_decisions).toHaveLength(1);
    await expect(
      exec(
        process.execPath,
        ['--import', 'tsx', 'scripts/restore.ts', '--input', output, '--confirm-empty'],
        { env: { ...env, DATA_DIR: second, PORT: new URL(url2).port } },
      ),
    ).rejects.toThrow();
  } finally {
    await a.close();
    await b.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
