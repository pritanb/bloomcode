import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { reviewNext } from '../../src/integrations/auto-review.js';
import type { Attempt, AutoReviewStatus } from '../../src/shared/contracts.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
async function backend() {
  const dir = await mkdtemp(join(tmpdir(), 'lc-auto-review-'));
  const app = await createApp({ dbPath: join(dir, 'leetcode.sqlite') });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  const p = (await api.request('POST', '/api/problems', {
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
  })) as { id: string };
  const started = (await api.request('POST', '/api/attempts', {
    problemId: p.id,
    context: 'targeted',
  })) as Attempt;
  const finish = (requestReview: boolean) =>
    api.request(
      'POST',
      `/api/attempts/${started.id}/finish`,
      {
        version: started.version,
        outcome: 'solved',
        help: 'none',
        activeSeconds: 593,
        code: 'def two_sum(n, t): ...',
        notes: 'Used a hash map',
        requestReview,
      },
      `finish-${started.id}`,
    ) as Promise<Attempt>;
  const status = () =>
    api.request('GET', `/api/attempts/${started.id}/auto-review`) as Promise<AutoReviewStatus>;
  return { dir, url, api, attemptId: started.id, finish, status };
}
test('a web submission queues a report that one claim generates, and a failure can be retried', async () => {
  const { api, attemptId, finish, status } = await backend();
  await finish(true);
  expect((await status()).status).toBe('pending');
  await finish(true); // an idempotent replay must not restart the queue
  let prompt = '';
  expect(
    await reviewNext(api, async () => {
      throw new Error('Codex timed out');
    }),
  ).toBe(true);
  expect(await status()).toMatchObject({
    status: 'failed',
    error: 'Codex timed out',
    tutorConnected: true,
  });
  expect(await reviewNext(api, async () => ({ text: 'never asked', model: null }))).toBe(false); // failed jobs wait for the learner
  await api.request('POST', `/api/attempts/${attemptId}/auto-review`, {});
  expect(
    await reviewNext(api, async (request) => {
      prompt = request.user;
      return { text: 'Summary:\nClean one-pass hash map.', model: null };
    }),
  ).toBe(true);
  expect(prompt).toContain('Two Sum');
  expect(prompt).toContain('def two_sum');
  expect((await status()).status).toBe('done');
  expect(((await api.request('GET', `/api/attempts/${attemptId}`)) as Attempt).feedback).toBe(
    'Summary:\nClean one-pass hash map.',
  );
});
test('a finish without the web flag (the tutor finishing in chat) queues nothing', async () => {
  const { api, finish, status } = await backend();
  await finish(false);
  expect((await status()).status).toBe('none');
  expect(await reviewNext(api, async () => ({ text: 'unused', model: null }))).toBe(false);
});
test('the browser session cannot claim review work', async () => {
  const { url } = await backend();
  const session = await fetch(`${url}/api/session`);
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const claim = await fetch(`${url}/api/auto-reviews/claim`, {
    method: 'POST',
    headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(claim.status).toBe(403);
});
