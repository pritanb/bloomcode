import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { mapVerifiedLists, PINNED_REVISION } from '../../src/integrations/lists.js';
import type { ProblemList, ProblemPage } from '../../src/shared/contracts.js';
import { readTables } from '../tables.js';

const exec = promisify(execFile);
// End-to-end verification of the unchanged CLI and canonical API, using only an
// isolated throwaway database.
test('real list CLI exposes both verified filters and retries without creating study history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-verified-lists-'));
  const app = await createApp({ dbPath: join(dir, 'leetcode.sqlite') });
  try {
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const api = new LocalApi({ dataDir: dir, baseUrl: url });
    const raw = await readFile(
      new URL('../../src/integrations/manifests/neetcode-problems.json', import.meta.url),
      'utf8',
    );
    const expected = mapVerifiedLists(raw, PINNED_REVISION, '2026-09-16T00:00:00Z');
    const env = { ...process.env, DATA_DIR: dir, PORT: new URL(url).port };
    for (let replay = 0; replay < 2; replay++) {
      const run = await exec(
        process.execPath,
        ['--import', 'tsx', 'scripts/import-lists.ts', '--apply'],
        { env, timeout: 20000 },
      );
      expect(JSON.parse(run.stdout)).toMatchObject({
        verified: true,
        verifiedSourceRecords: 150,
        blockers: [],
      });
      const ingestion = readTables(app.tutorJobs.db);
      expect(
        ingestion.problems!.every((p) => !p.legacyCompleted && p.exposed === (replay > 0 ? 1 : 0)),
      ).toBe(true);
      expect(ingestion.attempts).toEqual([]);
      const lists = (await api.request('GET', '/api/lists')) as ProblemList[];
      expect(lists).toHaveLength(2);
      for (const definition of expected.lists) {
        const list = lists.find((list) => list.name === definition.name)!;
        expect(list).toMatchObject({
          sourceUrl: definition.sourceUrl,
          sourceVersion: definition.sourceVersion,
        });
        const members = [];
        for (let page = 1; ; page++) {
          const result = (await api.request(
            'GET',
            `/api/problems?listId=${list.id}&page=${page}&pageSize=50`,
          )) as ProblemPage;
          expect(result.total).toBe(definition.count);
          members.push(...result.items);
          if (members.length >= result.total) break;
          expect(result.items.length).toBeGreaterThan(0);
        }
        expect(members.every((p) => !p.legacyCompleted && p.exposed && p.attemptCount === 0)).toBe(
          true,
        );
        expect(members.map((p) => p.slug).sort()).toEqual(
          expected.payload.problems
            .filter((p) => p.lists?.includes(list.name))
            .map((p) => p.key)
            .sort(),
        );
      }
      expect(
        ((await api.request('GET', '/api/problems?status=completed')) as ProblemPage).total,
      ).toBe(0);
      const tables = readTables(app.tutorJobs.db);
      expect(tables.problems).toHaveLength(150);
      expect(tables.import_batches).toHaveLength(1);
      expect(tables.import_records).toHaveLength(150);
      expect(tables.list_memberships).toHaveLength(225);
      expect(tables.tags!.length).toBeGreaterThan(0);

      expect(await api.request('GET', '/api/patterns')).toHaveLength(tables.tags!.length);
      expect(tables.attempts).toEqual([]);
      expect(tables.score_decisions).toEqual([]);
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
