import { expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import { mapQuestionPack } from '../../src/integrations/question-pack.js';
import { resolveDataDir } from '../../scripts/runtime.mjs';
import { join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/server/db/db.js';
import { settings } from '../../src/server/db/schema.js';

it('keeps explicit and legacy workspace paths while giving new installations platform defaults', () => {
  const home = '/test-home';
  expect(resolveDataDir({ env: { DATA_DIR: './private/test' }, home })).toBe(
    resolve('private/test'),
  );
  const legacy = join(home, 'Library', 'Application Support', 'LeetcodeTutor-dev');
  expect(
    resolveDataDir({
      env: {},
      platform: 'darwin',
      home,
      exists: (path) => path === join(legacy, 'leetcode.sqlite'),
    }),
  ).toBe(legacy);
  expect(resolveDataDir({ env: {}, platform: 'darwin', home, exists: () => false })).toBe(
    join(home, 'Library', 'Application Support', 'LeetCodeTutor'),
  );
  expect(resolveDataDir({ env: { XDG_DATA_HOME: '/data' }, platform: 'linux', home })).toBe(
    '/data/leetcode-tutor',
  );
  expect(resolveDataDir({ env: { LOCALAPPDATA: '/local' }, platform: 'win32', home })).toBe(
    '/local/LeetCodeTutor',
  );
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
    const snapshot = (await app.inject({ url: '/api/export', headers })).json();
    expect(snapshot.tables.problems).toHaveLength(75);
    expect(snapshot.tables.lists).toHaveLength(1);
    expect(snapshot.tables.attempts).toHaveLength(0);
    expect(snapshot.tables.score_decisions).toHaveLength(0);
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
          payload: { ...payload, list: 'NeetCode 250' },
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
  const { onboardingComplete: _removed, ...legacy } = db.orm.select().from(settings).get()!.data;
  db.orm
    .update(settings)
    .set({ data: { ...legacy, timezone: 'Australia/Sydney' } as typeof legacy })
    .run();
  db.sqlite.close();
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
    const snapshot = (await app.inject({ url: '/api/export', headers })).json();
    expect(snapshot.tables.problems).toHaveLength(1);
    expect(snapshot.tables.problems[0]).toMatchObject({ legacyCompleted: false, exposed: false });
    expect(snapshot.tables.attempts).toHaveLength(0);
    expect(snapshot.tables.score_decisions).toHaveLength(0);
    expect(snapshot.tables.import_batches).toHaveLength(1);
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
