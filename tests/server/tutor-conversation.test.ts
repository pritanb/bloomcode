import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TutorConversation } from '../../src/server/tutor/conversation.js';
import { createApp } from '../../src/server/core/app.js';

const workers: TutorConversation[] = [];
const worker = (timeout = 10000) => {
  const value = new TutorConversation(
    process.execPath,
    [resolve('tests/fixtures/tutor-worker.mjs')],
    timeout,
  );
  workers.push(value);
  return value;
};
afterEach(() => {
  workers.forEach((w) => w.stop());
  workers.length = 0;
});

test('worker streams, deduplicates requests and recovers from cancellation and crashes', async () => {
  const chat = worker();
  chat.start();
  await vi.waitFor(() => expect(chat.state.status).toBe('ready'));
  const id = randomUUID();
  chat.send(id, { method: 'reply', message: 'hello' });
  chat.send(id, { method: 'reply', message: 'hello' });
  expect(() => chat.send(id, { method: 'reply', message: 'different' })).toThrow();
  await vi.waitFor(() => expect(chat.state.messages).toHaveLength(2));
  chat.send(randomUUID(), { method: 'reply', message: 'slow' });
  await vi.waitFor(() => expect(chat.state.draft).toBe('Recorded evidence'));
  chat.stop();
  expect(chat.state.draft).toBe('');
  chat.start();
  await vi.waitFor(() => expect(chat.state.status).toBe('ready'));
  chat.send(randomUUID(), { method: 'reply', message: 'crash' });
  await vi.waitFor(() => expect(chat.state.status).toBe('error'));
});

test('bounded turn timeout closes the worker', async () => {
  const chat = worker(300);
  chat.start();
  await vi.waitFor(() => expect(chat.state.status).toBe('ready'));
  chat.send(randomUUID(), { method: 'reply', message: 'hang' });
  await vi.waitFor(() => expect(chat.state.error).toContain('timed out'));
});

test('practice blocks the UI and invalidates an in-flight reply; scoped model credentials cannot control the worker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bloom-chat-'));
  const chat = worker();
  const app = await createApp({
    dbPath: join(dir, 'study.sqlite'),
    token: 'host',
    conversationWorker: chat,
  });
  const headers = { authorization: 'Bearer host' };
  try {
    await app.inject({ method: 'POST', url: '/api/tutor-chat/open', headers });
    await vi.waitFor(() => expect(chat.state.status).toBe('ready'));
    const scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tutor-chat/message',
          headers: { authorization: `Bearer ${scoped}` },
          payload: { id: randomUUID(), message: 'write' },
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: 'POST',
      url: '/api/tutor-chat/message',
      headers,
      payload: { id: randomUUID(), message: 'slow' },
    });
    const problem = (
      await app.inject({
        method: 'POST',
        url: '/api/problems',
        headers,
        payload: { title: 'Protected', url: 'https://leetcode.com/problems/protected/' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers,
      payload: { problemId: problem.id, context: 'mixed' },
    });
    const state = (await app.inject({ method: 'GET', url: '/api/tutor-chat', headers })).json();
    expect(state).toMatchObject({ status: 'blocked', messages: [], draft: '', proposals: [] });
    expect(chat.state.status).toBe('closed');
    expect(
      (await app.inject({ method: 'POST', url: '/api/tutor-chat/open', headers })).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
