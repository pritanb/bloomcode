import { expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import { mapQuestionPack } from '../../src/integrations/question-pack.js';
import { resolveDataDir } from '../../scripts/runtime.mjs';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb, run } from '../../src/server/db/db.js';
import { readTables } from '../tables.js';

it('keeps explicit and legacy workspace paths while giving new installations platform defaults', () => {
  const home = '/test-home';
  expect(resolveDataDir({ env: { DATA_DIR: './private/test' }, home })).toBe(
    resolve('private/test'),
  );
  const support = join(home, 'Library', 'Application Support');
  const only = (target: string) => (path: string) => path === target;
  const legacy = join(support, 'LeetcodeTutor-dev');
  expect(
    resolveDataDir({
      env: {},
      platform: 'darwin',
      home,
      exists: only(join(legacy, 'leetcode.sqlite')),
    }),
  ).toBe(legacy);
  const darwin = { env: {}, platform: 'darwin', home };
  expect(resolveDataDir({ ...darwin, exists: only(join(support, 'LeetCodeTutor')) })).toBe(
    join(support, 'LeetCodeTutor'),
  );
  expect(resolveDataDir({ ...darwin, exists: () => false })).toBe(join(support, 'BloomCode'));
  const linux = { env: { XDG_DATA_HOME: '/data' }, platform: 'linux', home };
  expect(resolveDataDir({ ...linux, exists: () => false })).toBe('/data/bloomcode');
  expect(resolveDataDir({ ...linux, exists: only('/data/leetcode-tutor') })).toBe(
    '/data/leetcode-tutor',
  );
  const windows = { env: { LOCALAPPDATA: '/local' }, platform: 'win32', home };
  expect(resolveDataDir({ ...windows, exists: () => false })).toBe('/local/BloomCode');
  expect(resolveDataDir({ ...windows, exists: only('/local/LeetCodeTutor') })).toBe(
    '/local/LeetCodeTutor',
  );
});

it('keeps using a pre-rename workspace in place until a BloomCode database exists', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bloomcode-paths-'));
  try {
    const support = join(home, 'Library', 'Application Support');
    const legacy = join(support, 'LeetCodeTutor');
    const current = join(support, 'BloomCode');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'leetcode.sqlite'), 'legacy');
    // A desktop profile folder alone must not divert the app to an empty workspace.
    await mkdir(join(current, 'desktop-profile'), { recursive: true });
    expect(resolveDataDir({ env: {}, platform: 'darwin', home })).toBe(legacy);
    expect(await readFile(join(legacy, 'leetcode.sqlite'), 'utf8')).toBe('legacy');
    expect(existsSync(join(current, 'leetcode.sqlite'))).toBe(false);
    await writeFile(join(current, 'leetcode.sqlite'), '');
    expect(resolveDataDir({ env: {}, platform: 'darwin', home })).toBe(current);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it('authenticates setup and imports exactly the selected starter list', async () => {
  const app = await createApp({ dbPath: ':memory:', token: 'setup-test' });
  const headers = { authorization: 'Bearer setup-test' };
  const payload = { timezone: 'Europe/London', questionsPerDay: 3, list: 'Blind 75' };
  try {
    expect((await app.inject({ method: 'POST', url: '/api/setup', payload })).statusCode).toBe(401);
    const session = await app.inject('/api/session');
    const cookie = session.headers['set-cookie']!.toString().split(';')[0]!;
    expect(
      (await app.inject({ method: 'POST', url: '/api/setup', headers: { cookie }, payload }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers,
          payload: { ...payload, timezone: 'invalid' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers: { cookie, 'x-csrf-token': session.json().csrfToken },
          payload,
        })
      ).statusCode,
    ).toBe(200);
    const tables = readTables(app.tutorJobs.db);
    expect(tables.problems).toHaveLength(75);
    expect(tables.lists).toHaveLength(1);
    expect(tables.attempts).toHaveLength(0);
    expect(tables.score_decisions).toHaveLength(0);
    expect((await app.inject({ url: '/api/settings', headers })).json()).toMatchObject({
      timezone: 'Europe/London',
      questionsPerDay: 3,
      onboardingComplete: true,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers,
          payload: { ...payload, list: 'NeetCode 150' },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

it('does not offer setup to a workspace saved before onboarding existed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-setup-legacy-'));
  const dbPath = join(dir, 'leetcode.sqlite');
  const headers = { authorization: 'Bearer setup-test' };
  await (await createApp({ dbPath, token: 'setup-test' })).close();
  // Settings written by an older version have no onboardingComplete flag.
  const db = openDb(dbPath);
  run(db, "UPDATE settings SET onboardingComplete = NULL, timezone = 'Australia/Sydney'");
  db.close();
  const app = await createApp({ dbPath, token: 'setup-test' });
  try {
    expect((await app.inject({ url: '/api/setup', headers })).json()).toEqual({ required: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers,
          payload: { timezone: 'UTC', questionsPerDay: 2, list: 'none' },
        })
      ).statusCode,
    ).toBe(409);
    expect((await app.inject({ url: '/api/settings', headers })).json().timezone).toBe(
      'Australia/Sydney',
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('drops the unused minute budgets from a version 7 workspace and keeps planning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-v7-'));
  const dbPath = join(dir, 'leetcode.sqlite');
  const headers = { authorization: 'Bearer setup-test' };
  // Recreate the version 7 columns, both NOT NULL, as the live database has them.
  const old = openDb(dbPath);
  old.exec(`ALTER TABLE settings ADD COLUMN budgetMinutes INTEGER NOT NULL DEFAULT 40;
    ALTER TABLE plan_items ADD COLUMN suggestedMinutes INTEGER NOT NULL DEFAULT 13;`);
  old.exec('DROP TABLE learning_goals; DROP TABLE tutor_preferences');
  old.pragma('user_version = 7');
  old.close();
  const app = await createApp({ dbPath, token: 'setup-test' });
  try {
    await app.inject({
      method: 'POST',
      url: '/api/problems',
      headers,
      payload: { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/' },
    });
    const plan = await app.inject({
      method: 'POST',
      url: '/api/daily-plan/ensure',
      headers,
      payload: {},
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().items).toHaveLength(1);
  } finally {
    await app.close();
  }
  const db = openDb(dbPath);
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
  expect(db.pragma('user_version', { simple: true })).toBe(10);
  expect(columns('settings')).not.toContain('budgetMinutes');
  expect(columns('plan_items')).not.toContain('suggestedMinutes');
  db.close();
  await rm(dir, { recursive: true, force: true });
});

it('imports a validated custom pack idempotently without creating completion or score evidence', async () => {
  const app = await createApp({ dbPath: ':memory:', token: 'pack-test' });
  const headers = { authorization: 'Bearer pack-test' };
  const pack = {
    version: 1,
    name: 'Example warmup',
    questions: [
      { title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', tags: ['Hash table'] },
    ],
  };
  try {
    expect(() => mapQuestionPack({ ...pack, version: 2 })).toThrow();
    expect(() => mapQuestionPack({ ...pack, name: 'Blind 75' })).toThrow();
    expect(() =>
      mapQuestionPack({ ...pack, questions: [pack.questions[0], pack.questions[0]] }),
    ).toThrow();
    expect(() =>
      mapQuestionPack({ ...pack, questions: [{ ...pack.questions[0], legacyCompleted: true }] }),
    ).toThrow();
    const payload = { ...mapQuestionPack(pack), dryRun: false };
    for (let i = 0; i < 2; i++)
      expect(
        (await app.inject({ method: 'POST', url: '/api/import', headers, payload })).statusCode,
      ).toBe(200);
    const tables = readTables(app.tutorJobs.db);
    expect(tables.problems).toHaveLength(1);
    expect(tables.problems![0]).toMatchObject({ legacyCompleted: 0, exposed: 0 });
    expect(tables.attempts).toHaveLength(0);
    expect(tables.score_decisions).toHaveLength(0);
    expect(tables.import_batches).toHaveLength(1);
    expect((await app.inject({ url: '/api/setup', headers })).json()).toEqual({ required: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          headers,
          payload: { timezone: 'UTC', questionsPerDay: 2, list: 'none' },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});
