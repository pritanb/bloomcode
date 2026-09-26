import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import type { ProblemList } from '../../src/shared/contracts.js';

it('retires Sheet-only lists and settings once, after saving a copy of the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-sheet-retirement-'));
  const dbPath = join(dir, 'leetcode.sqlite');
  const headers = { authorization: 'Bearer test' };
  let app = await createApp({ dbPath, token: 'test' });
  try {
    const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    const problem = (
      await call('POST', '/api/problems', {
        title: 'Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
      })
    ).json();
    const lists: ProblemList[] = [];
    for (const name of ['Sheet: Tutor Tracker', 'Sheet: Microsoft Top Questions', 'Keep me'])
      lists.push((await call('POST', '/api/lists', { name })).json());
    await call('PATCH', `/api/problems/${problem.id}`, { listIds: lists.map((l) => l.id) });
    await app.close();
    // Put the database back to how the Sheet era left it, before the cleanup migration.
    const old = new Database(dbPath);
    old.exec(`UPDATE settings SET data = json_set(data, '$.dataMode', 'isolated-pilot')`);
    old.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(1789516800003);
    old.close();

    app = await createApp({ dbPath, token: 'test' });
    expect(((await call('GET', '/api/lists')).json() as ProblemList[]).map((l) => l.name)).toEqual([
      'Microsoft Top Questions',
      'Keep me',
    ]);
    expect(
      (await call('GET', `/api/problems/${problem.id}`))
        .json()
        .problem.lists.map((l: ProblemList) => l.name)
        .sort(),
    ).toEqual(['Keep me', 'Microsoft Top Questions']);
    expect((await call('GET', '/api/settings')).json()).not.toHaveProperty('dataMode');
    // The copy taken before migrating still holds the retired list.
    const [copy] = readdirSync(join(dir, 'backups')).filter((f) =>
      f.startsWith('before-migration-'),
    );
    const saved = new Database(join(dir, 'backups', copy!), { readonly: true });
    expect(
      saved
        .prepare(`SELECT count(*) AS n FROM lists WHERE json_extract(data, '$.name') = ?`)
        .get('Sheet: Tutor Tracker'),
    ).toEqual({ n: 1 });
    saved.close();
    await app.close();
    // Up to date now: reopening neither migrates nor copies again.
    app = await createApp({ dbPath, token: 'test' });
    await app.ready();
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
