import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import type { ProblemList } from '../../src/shared/contracts.js';

const migrations = new URL('../../migrations/', import.meta.url).pathname;
/** A database as the Sheet-era app left it: migrations 0000-0002 and JSON rows. */
function sheetEraDatabase(dbPath: string) {
  const db = new Database(dbPath);
  for (const file of ['0000_initial.sql', '0001_patterns.sql', '0002_learning_insights.sql'])
    db.exec(readFileSync(join(migrations, file), 'utf8'));
  db.pragma('user_version = 3');
  const row = (table: string, id: string, data: object, columns: Record<string, string> = {}) =>
    db
      .prepare(
        `INSERT INTO ${table} (id, data${Object.keys(columns)
          .map((c) => `, ${c}`)
          .join('')}) VALUES (?, ?${Object.keys(columns)
          .map(() => ', ?')
          .join('')})`,
      )
      .run(id, JSON.stringify({ id, ...data }), ...Object.values(columns));
  row('settings', 'singleton', {
    timezone: 'UTC',
    budgetMinutes: 40,
    primaryCount: 1,
    optionalCount: 1,
    lastBackupAt: null,
    dataMode: 'isolated-pilot',
  });
  row('problems', 'p', {
    slug: 'two-sum',
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    notes: '',
    legacyCompleted: false,
    exposed: false,
  });
  const names = ['Sheet: Tutor Tracker', 'Sheet: Microsoft Top Questions', 'Keep me'];
  names.forEach((name, i) => {
    row('lists', `l${i}`, { name, sourceUrl: null, sourceVersion: null });
    row(
      'list_memberships',
      `p:l${i}`,
      { problemId: 'p', listId: `l${i}` },
      { problem_id: 'p', list_id: `l${i}` },
    );
  });
  db.close();
}

it('retires Sheet-only lists and settings once, after saving a copy of the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-sheet-retirement-'));
  const dbPath = join(dir, 'leetcode.sqlite');
  sheetEraDatabase(dbPath);
  const headers = { authorization: 'Bearer test' };
  let app = await createApp({ dbPath, token: 'test' });
  try {
    const call = (url: string) => app.inject({ url, headers });
    expect(((await call('/api/lists')).json() as ProblemList[]).map((l) => l.name)).toEqual([
      'Microsoft Top Questions',
      'Keep me',
    ]);
    expect(
      (await call('/api/problems/p'))
        .json()
        .problem.lists.map((l: ProblemList) => l.name)
        .sort(),
    ).toEqual(['Keep me', 'Microsoft Top Questions']);
    expect((await call('/api/settings')).json()).not.toHaveProperty('dataMode');
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
