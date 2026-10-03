import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { openDb } from '../../src/server/db/db.js';

let app: Awaited<ReturnType<typeof createApp>>, dir: string, scoped: string;
const request = (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  token = 'host',
  key = 'create',
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const create = {
  change: { action: 'create', text: 'Solve two distinct sliding-window problems without hints' },
  sourceConversation: 'conversation-1',
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-goals-'));
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
  scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('scoped tutor can read but cannot confirm goals, change scores or use unrelated routes', async () => {
  expect((await request('GET', '/api/learning-goals', undefined, scoped)).statusCode).toBe(200);
  for (const path of [
    '/api/learning-goals',
    '/api/import',
    '/api/backup',
    '/api/attempts',
    '/api/insights/enable',
  ])
    expect((await request('POST', path, create, scoped)).statusCode).toBe(403);
  expect((await request('GET', '/api/settings', undefined, scoped)).statusCode).toBe(403);
  expect((await request('GET', '/api/learning-goals', undefined, 'invalid')).statusCode).toBe(401);
  expect((await request('GET', '/api/learning-goals')).json().goals).toEqual([]);
});

test('confirmed goals survive restart and backup; retries and equivalent active goals do not duplicate', async () => {
  const saved = await request('POST', '/api/learning-goals', create);
  expect(saved.statusCode).toBe(200);
  const goal = saved.json();
  expect(goal).toMatchObject({
    text: create.change.text,
    state: 'active',
    version: 0,
    sourceConversation: 'conversation-1',
  });
  expect((await request('POST', '/api/learning-goals', create)).json()).toEqual(goal);
  expect(
    (await request('POST', '/api/learning-goals', create, 'host', 'different-key')).json(),
  ).toEqual(goal);
  expect(
    (await request('POST', '/api/learning-goals', { ...create, sourceConversation: 'different' }))
      .statusCode,
  ).toBe(409);
  const backup = (await request('POST', '/api/backup', {})).json();
  const db = openDb(backup.path);
  expect(db.prepare('SELECT text FROM learning_goals').get()).toEqual({ text: create.change.text });
  db.close();
  await app.close();
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
  expect((await request('GET', '/api/learning-goals', undefined, scoped)).json().goals).toEqual([
    goal,
  ]);
});

test('goal state changes require a current version and are duplicate-safe', async () => {
  const goal = (await request('POST', '/api/learning-goals', create)).json();
  const body = {
    change: {
      action: 'set_state',
      goalId: goal.id,
      text: goal.text,
      expectedVersion: 0,
      state: 'completed',
    },
    sourceConversation: 'conversation-2',
  };
  expect(
    (
      await request(
        'POST',
        '/api/learning-goals',
        {
          ...body,
          change: { ...body.change, text: 'A different goal' },
        },
        'host',
        'wrong-text',
      )
    ).statusCode,
  ).toBe(409);
  const saved = (await request('POST', '/api/learning-goals', body, 'host', 'complete')).json();
  expect(saved).toMatchObject({ state: 'completed', version: 1 });
  expect((await request('POST', '/api/learning-goals', body, 'host', 'complete')).json()).toEqual(
    saved,
  );
  expect((await request('POST', '/api/learning-goals', body, 'host', 'stale')).statusCode).toBe(
    409,
  );
  expect((await request('GET', '/api/learning-goals')).json().goals).toEqual([]);
  expect((await request('GET', '/api/learning-goals?state=completed')).json().goals).toEqual([
    saved,
  ]);
});

test('assessment restrictions hide goals and reject confirmation', async () => {
  await request('POST', '/api/learning-goals', create);
  const problem = (
    await request('POST', '/api/problems', {
      title: 'Fresh',
      url: 'https://leetcode.com/problems/fresh/',
    })
  ).json();
  await request('POST', '/api/attempts', { problemId: problem.id, context: 'mixed' });
  expect((await request('GET', '/api/learning-goals', undefined, scoped)).statusCode).toBe(403);
  expect((await request('POST', '/api/learning-goals', create)).statusCode).toBe(403);
});

test('version 8 workspaces migrate without losing study records', async () => {
  const problem = (
    await request('POST', '/api/problems', {
      title: 'Preserved',
      url: 'https://leetcode.com/problems/preserved/',
    })
  ).json();
  await app.close();
  const path = join(dir, 'study.sqlite');
  const old = openDb(path);
  old.exec(
    'DROP TABLE learning_goals; DROP TABLE tutor_preferences; DROP TABLE plan_drafts; DROP TABLE rating_estimates; DROP TABLE problem_popularity; DROP TABLE attempt_signals; ALTER TABLE plan_items DROP COLUMN reviewOf',
  );
  old.pragma('user_version = 8');
  old.close();
  app = await createApp({ dbPath: path, token: 'host' });
  expect((await request('GET', `/api/problems/${problem.id}`)).json().problem.title).toBe(
    'Preserved',
  );
  expect((await request('GET', '/api/learning-goals')).json().goals).toEqual([]);
});

test('preferences require host confirmation, reject stale corrections, and survive backup/restart', async () => {
  const initial = (await request('GET', '/api/tutor-preferences', undefined, scoped)).json();
  expect(initial).toMatchObject({
    explanationDepth: 'concise',
    hintStyle: 'progressive',
    version: 0,
    sourceConversation: null,
  });
  const first = {
    change: { explanationDepth: 'detailed', hintStyle: 'questions', expectedVersion: 0 },
    sourceConversation: 'first-chat',
  };
  expect((await request('POST', '/api/tutor-preferences', first, scoped, 'prefs')).statusCode).toBe(
    403,
  );
  const saved = (await request('POST', '/api/tutor-preferences', first, 'host', 'prefs')).json();
  expect(saved).toMatchObject({ explanationDepth: 'detailed', hintStyle: 'questions', version: 1 });
  expect((await request('POST', '/api/tutor-preferences', first, 'host', 'prefs')).json()).toEqual(
    saved,
  );
  const correction = {
    change: { explanationDepth: 'concise', hintStyle: 'direct', expectedVersion: 1 },
    sourceConversation: 'correction-chat',
  };
  const corrected = (
    await request('POST', '/api/tutor-preferences', correction, 'host', 'correction')
  ).json();
  expect(corrected).toMatchObject({
    explanationDepth: 'concise',
    hintStyle: 'direct',
    version: 2,
    sourceConversation: 'correction-chat',
  });
  expect(
    (await request('POST', '/api/tutor-preferences', first, 'host', 'stale-prefs')).statusCode,
  ).toBe(409);
  expect(
    (
      await request(
        'POST',
        '/api/tutor-preferences',
        { ...correction, diagnosis: 'weak memory' },
        'host',
        'invalid-prefs',
      )
    ).statusCode,
  ).toBe(400);
  const backup = (await request('POST', '/api/backup', {})).json();
  const copy = openDb(backup.path);
  expect(copy.prepare('SELECT hintStyle FROM tutor_preferences').get()).toEqual({
    hintStyle: 'direct',
  });
  copy.close();
  await app.close();
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
  expect((await request('GET', '/api/tutor-preferences', undefined, scoped)).json()).toEqual(
    corrected,
  );
});

test('version 9 migration adds preferences while retaining agreed goals', async () => {
  const goal = (await request('POST', '/api/learning-goals', create)).json();
  await app.close();
  const path = join(dir, 'study.sqlite'),
    old = openDb(path);
  old.exec(
    'DROP TABLE tutor_preferences; DROP TABLE plan_drafts; DROP TABLE rating_estimates; DROP TABLE problem_popularity; DROP TABLE attempt_signals; ALTER TABLE plan_items DROP COLUMN reviewOf',
  );
  old.pragma('user_version = 9');
  old.close();
  app = await createApp({ dbPath: path, token: 'host' });
  expect((await request('GET', '/api/learning-goals')).json().goals).toEqual([goal]);
  expect((await request('GET', '/api/tutor-preferences')).json().version).toBe(0);
});
