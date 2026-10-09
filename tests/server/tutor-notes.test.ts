import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { openDb } from '../../src/server/db/db.js';
import { notesInBudget } from '../../src/shared/tutor-notes.js';

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
const lesson =
  "Don't present a problem as Tries practice when its main idea is DP (Extra Characters in a String).";
const create = {
  change: { action: 'create', text: lesson, topic: 'Tries' },
  sourceConversation: 'chat-1',
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-notes-'));
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
  scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('the tutor can read lessons but only the host can save or forget them', async () => {
  expect((await request('GET', '/api/tutor-notes', undefined, scoped)).json()).toEqual({
    notes: [],
    total: 0,
    hasMore: false,
  });
  expect((await request('POST', '/api/tutor-notes', create, scoped)).statusCode).toBe(403);
  const saved = (await request('POST', '/api/tutor-notes', create)).json();
  expect(
    (await request('POST', `/api/tutor-notes/${saved.id}/forget`, {}, scoped)).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        'POST',
        '/api/tutor-notes',
        {
          ...create,
          change: { ...create.change, topic: 'Wizardry' },
        },
        'host',
        'bad-topic',
      )
    ).statusCode,
  ).toBe(400);
});

test('confirmed lessons dedupe, update in place, retire and survive backup', async () => {
  const saved = (await request('POST', '/api/tutor-notes', create)).json();
  expect(saved).toMatchObject({ text: lesson, topic: 'Tries', state: 'active', version: 0 });
  // A retry and an equivalent lesson both return the saved one.
  expect((await request('POST', '/api/tutor-notes', create)).json()).toEqual(saved);
  expect((await request('POST', '/api/tutor-notes', create, 'host', 'same-text')).json().id).toBe(
    saved.id,
  );

  const update = {
    change: {
      action: 'update',
      noteId: saved.id,
      expectedVersion: 0,
      oldText: lesson,
      text: `${lesson} Say the trie is optional, or pick another problem.`,
      topic: 'Tries',
    },
    sourceConversation: 'chat-2',
  };
  const updated = (await request('POST', '/api/tutor-notes', update, 'host', 'update')).json();
  expect(updated).toMatchObject({ id: saved.id, text: update.change.text, version: 1 });
  // A card shown before the update is stale: version and text no longer match.
  expect((await request('POST', '/api/tutor-notes', update, 'host', 'stale')).statusCode).toBe(409);

  const general = {
    change: { action: 'create', text: 'Explain complexity before showing code.', topic: null },
    sourceConversation: 'chat-2',
  };
  await request('POST', '/api/tutor-notes', general, 'host', 'general');
  const listed = (await request('GET', '/api/tutor-notes', undefined, scoped)).json();
  expect(listed.notes.map((n: { topic: string | null }) => n.topic)).toEqual([null, 'Tries']);

  const backup = (await request('POST', '/api/backup', {})).json();
  const copy = openDb(backup.path);
  expect(
    copy.prepare("SELECT count(*) AS n FROM tutor_notes WHERE state = 'active'").get(),
  ).toEqual({ n: 2 });
  copy.close();

  const retire = {
    change: { action: 'retire', noteId: saved.id, expectedVersion: 1, text: update.change.text },
    sourceConversation: 'chat-3',
  };
  expect((await request('POST', '/api/tutor-notes', retire, 'host', 'retire')).json().state).toBe(
    'retired',
  );
  const generalId = listed.notes[0].id;
  expect((await request('POST', `/api/tutor-notes/${generalId}/forget`, {})).statusCode).toBe(200);
  expect((await request('GET', '/api/tutor-notes?all=true')).json().notes).toEqual([]);
});

test('past the budget, lessons narrow to general ones and the topics in play', () => {
  const notes = [
    { text: 'g'.repeat(10), topic: null },
    { text: 't'.repeat(10), topic: 'Tries' },
    { text: 'd'.repeat(10), topic: '1-D Dynamic Programming' },
  ];
  expect(notesInBudget(notes, () => [], 30)).toEqual({ notes, total: 3, hasMore: false });
  expect(notesInBudget(notes, () => ['Tries'], 20)).toEqual({
    notes: notes.slice(0, 2),
    total: 3,
    hasMore: true,
  });
});
