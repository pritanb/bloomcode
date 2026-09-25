import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { mapVerifiedLists, PINNED_REVISION } from '../../src/integrations/lists.js';
import type { ProblemList, ProblemPage, Snapshot } from '../../src/shared/contracts.js';

const exec = promisify(execFile);
// End-to-end verification of the unchanged CLI and canonical API, using only an
// isolated throwaway database. This never reads or writes the live pilot.
test('real list CLI exposes all three verified filters and retries without creating study history', async () => {
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
        verifiedSourceRecords: 400,
        blockers: [],
      });
      const ingestion = (await api.request('GET', '/api/export')) as Snapshot;
      expect(
        ingestion.tables.problems.every(
          (p) => !p.legacyCompleted && p.attemptCount === 0 && p.exposed === replay > 0,
        ),
      ).toBe(true);
      const lists = (await api.request('GET', '/api/lists')) as ProblemList[];
      expect(lists).toHaveLength(3);
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
      const snapshot = (await api.request('GET', '/api/export')) as Snapshot;
      expect(snapshot.tables.problems).toHaveLength(250);
      expect(snapshot.tables.import_batches).toHaveLength(1);
      expect(snapshot.tables.import_records).toHaveLength(400);
      expect(snapshot.tables.list_memberships).toHaveLength(475);
      expect(snapshot.tables.tags.length).toBeGreaterThan(0);

      expect(await api.request('GET', '/api/patterns')).toHaveLength(snapshot.tables.tags.length);
      expect(snapshot.tables.attempts).toEqual([]);
      expect(snapshot.tables.score_decisions).toEqual([]);
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
