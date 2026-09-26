import { expect, test } from 'vitest';
import { readTables } from '../tables.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import legacyListsImport from './fixtures/legacy-lists-import.json';
import { mapVerifiedLists, PINNED_REVISION } from '../../src/integrations/lists.js';
import type { ImportPayload, ProblemList, ProblemPage } from '../../src/shared/contracts.js';

test('projects verified slug memberships without rewriting stored history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-list-projection-'));
  const app = await createApp({ dbPath: join(dir, 'test.sqlite') });
  try {
    const api = new LocalApi({
      dataDir: dir,
      baseUrl: await app.listen({ port: 0, host: '127.0.0.1' }),
    });
    const verified = mapVerifiedLists(
      await readFile(
        new URL('../../src/integrations/manifests/neetcode-problems.json', import.meta.url),
        'utf8',
      ),
      PINNED_REVISION,
      '2026-09-16T00:00:00Z',
    );
    // List metadata exists, but no public-list membership edges were imported.
    for (const { count: _count, ...list } of verified.lists)
      await api.request('POST', '/api/lists', list);
    // An earlier release bundled NeetCode 250. Its stored list and memberships
    // stay usable after the manifest was removed.
    await api.request('POST', '/api/lists', {
      name: 'NeetCode 250',
      sourceUrl: 'https://neetcode.io/main.f39af0c52a4e9fb5.js',
      sourceVersion: 'sha256:426da304cbc42c91a25986ed680c06fd632fc25da741ac2881fd928ac9a051a8',
    });
    // Captured from a retired progress importer: a list, one attempt and raw records.
    const payload = structuredClone(legacyListsImport) as ImportPayload;
    payload.problems.push(
      {
        key: 'concatenation-of-array',
        title: 'Concatenation of Array',
        url: 'https://leetcode.com/problems/concatenation-of-array/',
        lists: ['NeetCode 250'],
        exposed: true,
      },
      {
        key: 'unrelated-fixture',
        title: 'Contains Duplicate',
        url: 'https://leetcode.com/problems/unrelated-fixture/',
        lists: ['My custom list'],
        exposed: true,
      },
    );
    await api.request('POST', '/api/import', { ...payload, dryRun: false });
    // A second source for the same slug must merge identity, not add a question.
    await api.request('POST', '/api/import', {
      ...payload,
      dryRun: false,
      importId: 'second-source',
      source: { retrievedAt: '2026-09-16T00:00:00Z' },
      problems: [
        {
          key: 'same',
          title: 'Different source title',
          url: 'https://leetcode.com/problems/contains-duplicate/',
          lists: ['My custom list'],
        },
      ],
      attempts: [],
      records: [],
    });
    const before = readTables(app.tutorJobs.db);
    const lists = (await api.request('GET', '/api/lists')) as ProblemList[];
    expect(lists.map((l) => l.name).sort()).toEqual(
      [
        'Blind 75',
        'Microsoft Top Questions',
        'My custom list',
        'NeetCode 150',
        'NeetCode 250',
      ].sort(),
    );
    const options = (await api.request('GET', '/api/recommendations/options')) as {
      lists: { id: string; name: string }[];
    };
    expect(options.lists).toEqual(lists.map(({ id, name }) => ({ id, name })));
    expect(readTables(app.tutorJobs.db)).toEqual(before);
    const page = (await api.request('GET', '/api/problems')) as ProblemPage;
    expect(page.total).toBe(3);
    const question = page.items.find((p) => p.slug === 'contains-duplicate')!;
    expect(question.lists.map((l) => l.name).sort()).toEqual(
      lists
        .map((l) => l.name)
        .filter((name) => name !== 'NeetCode 250')
        .sort(),
    );
    expect(question.latestSubmission).toMatchObject({
      outcome: 'solved',
      activeSeconds: 754,
      notes: 'Original evidence',
    });
    expect(
      page.items.find((p) => p.slug === 'unrelated-fixture')!.lists.map((l) => l.name),
    ).toEqual(['My custom list']);
    for (const name of [...verified.lists.map((l) => l.name), 'NeetCode 250']) {
      const list = lists.find((l) => l.name === name)!;
      const filtered = (await api.request('GET', `/api/problems?listId=${list.id}`)) as ProblemPage;
      const expected =
        name === 'NeetCode 250' ? ['concatenation-of-array'] : ['contains-duplicate'];
      expect(filtered.total).toBe(expected.length);
      expect(filtered.items.map((p) => p.slug).sort()).toEqual(expected);
    }
    expect(readTables(app.tutorJobs.db)).toEqual(before);
    // The editor sends displayed memberships back even for a notes-only save.
    // This must not persist memberships derived from the public manifests.
    await api.request('PATCH', `/api/problems/${question.id}`, {
      listIds: question.lists.map((l) => l.id),
    });
    expect(readTables(app.tutorJobs.db)).toEqual(before);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
