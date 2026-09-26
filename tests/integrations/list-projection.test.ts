import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import sheetListsImport from './fixtures/sheet-lists-import.json';
import { mapVerifiedLists, PINNED_REVISION } from '../../src/integrations/lists.js';
import type {
  ImportPayload,
  ProblemList,
  ProblemPage,
  Snapshot,
} from '../../src/shared/contracts.js';

test('projects verified slug memberships without exposing Sheet provenance or rewriting history', async () => {
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
    // Captured from the retired Sheet mapper: lists, one attempt and one plan row.
    const payload = structuredClone(sheetListsImport) as ImportPayload;
    payload.problems.push(
      {
        key: 'concatenation-of-array',
        title: 'Concatenation of Array',
        url: 'https://leetcode.com/problems/concatenation-of-array/',
        lists: ['Sheet: Others'],
        exposed: true,
      },
      {
        key: 'unrelated-fixture',
        title: 'Contains Duplicate',
        url: 'https://leetcode.com/problems/unrelated-fixture/',
        lists: ['Sheet: Neetcode List', 'My custom list'],
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
      planned: [],
      records: [],
    });
    const before = (await api.request('GET', '/api/export')) as Snapshot;
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
    expect(((await api.request('GET', '/api/export')) as Snapshot).tables).toEqual(before.tables);
    const page = (await api.request('GET', '/api/problems')) as ProblemPage;
    expect(page.total).toBe(3);
    const question = page.items.find((p) => p.slug === 'contains-duplicate')!;
    expect(question.lists.map((l) => l.name).sort()).toEqual(lists.map((l) => l.name).sort());
    expect(question.latestSubmission).toMatchObject({
      outcome: 'solved',
      activeSeconds: 754,
      notes: 'Original evidence',
    });
    expect(
      page.items.find((p) => p.slug === 'unrelated-fixture')!.lists.map((l) => l.name),
    ).toEqual(['My custom list']);
    for (const definition of verified.lists) {
      const list = lists.find((l) => l.name === definition.name)!;
      const filtered = (await api.request('GET', `/api/problems?listId=${list.id}`)) as ProblemPage;
      const expected =
        definition.name === 'NeetCode 250'
          ? ['concatenation-of-array', 'contains-duplicate']
          : ['contains-duplicate'];
      expect(filtered.total).toBe(expected.length);
      expect(filtered.items.map((p) => p.slug).sort()).toEqual(expected);
    }
    // Old source-list bookmarks retain their exact stored meaning, not a guessed alias.
    const sourceList = before.tables.lists.find((l) => l.name === 'Sheet: Neetcode List')!;
    const legacy = (await api.request(
      'GET',
      `/api/problems?listId=${sourceList.id}`,
    )) as ProblemPage;
    expect(legacy.items.map((p) => p.slug).sort()).toEqual([
      'contains-duplicate',
      'unrelated-fixture',
    ]);
    expect(((await api.request('GET', '/api/export')) as Snapshot).tables).toEqual(before.tables);
    // The editor sends displayed memberships back even for a notes-only save.
    // This must neither drop hidden provenance nor persist derived memberships.
    await api.request('PATCH', `/api/problems/${question.id}`, {
      listIds: question.lists.map((l) => l.id),
    });
    expect(((await api.request('GET', '/api/export')) as Snapshot).tables).toEqual(before.tables);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
