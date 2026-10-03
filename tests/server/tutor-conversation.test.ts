import { afterEach, expect, test, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  TutorConversation,
  chatProviderArgs,
  tutorRuntimePaths,
} from '../../src/server/tutor/conversation.js';
import { defaultTutorSettings } from '../../src/shared/tutor.js';
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

test('desktop staging uses the development worktree for both interpreter and worker', () => {
  const root = resolve('test-worktree');
  const paths = tutorRuntimePaths(resolve('dist/electron-stage'), { BLOOMCODE_TUTOR_ROOT: root });
  expect(paths.worker).toBe(join(root, 'python/worker.py'));
  expect(paths.python).toBe(
    join(root, 'python/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  );
  expect(tutorRuntimePaths(root, { BLOOMCODE_PYTHON: '/custom/python' })).toEqual({
    python: '/custom/python',
    worker: join(root, 'python/worker.py'),
  });
});

test('chat starts on the saved provider and relaunches when it changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-chat-provider-'));
  try {
    expect(await chatProviderArgs(dir)).toEqual([]); // Codex stays the default
    const claude = join(dir, 'claude');
    writeFileSync(claude, '#!/bin/sh\n');
    chmodSync(claude, 0o755);
    writeFileSync(
      join(dir, 'tutor-settings.json'),
      JSON.stringify({ ...defaultTutorSettings, provider: 'claude', claudePath: claude }),
    );
    const args = await chatProviderArgs(dir);
    expect(args).toEqual(['--provider', 'claude', '--model', 'opus', '--cli-path', claude]);
    const chat = worker();
    chat.start();
    await vi.waitFor(() => expect(chat.state.status).toBe('ready'));
    chat.configure([...chat.baseArgs()]); // unchanged: keeps running
    expect(chat.state.status).toBe('ready');
    chat.configure([...chat.baseArgs(), ...args]);
    expect(chat.baseArgs()).toEqual([resolve('tests/fixtures/tutor-worker.mjs')]);
    expect(chat.state.status).not.toBe('ready');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  chat.send(randomUUID(), { method: 'reply', message: 'failed-step' });
  await vi.waitFor(() => expect(chat.state.coaching?.needsRetry).toBe(true));
  expect(chat.state.messages).toHaveLength(0);
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
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tutor-chat/message',
          headers,
          payload: { id: randomUUID(), message: 'coach this', attemptId: randomUUID() },
        })
      ).statusCode,
    ).toBe(400);
    const scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tutor-chat/message',
          headers: { authorization: `Bearer ${scoped}` },
          payload: { id: randomUUID(), message: 'write', coach: 'latest' },
        })
      ).statusCode,
    ).toBe(403);
    const send = vi.spyOn(chat, 'send');
    const requestId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/tutor-chat/message',
      headers,
      payload: { id: requestId, message: 'slow', coach: 'latest' },
    });
    expect(send).toHaveBeenCalledWith(requestId, {
      method: 'reply',
      message: 'slow',
      coach: 'latest',
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
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/tutor-access',
          headers: { authorization: `Bearer ${scoped}` },
        })
      ).json(),
    ).toEqual({ allowed: false });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tutor-chat/coaching',
          headers,
          payload: { id: randomUUID(), action: 'resume' },
        })
      ).statusCode,
    ).toBe(403);
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
