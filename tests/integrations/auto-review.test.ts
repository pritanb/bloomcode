import { afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
      throw new Error('Sampling timed out');
    }),
  ).toBe(true);
  expect(await status()).toMatchObject({
    status: 'failed',
    error: 'Sampling timed out',
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
test('the stdio adapter asks a sampling client to write the report and saves it', async () => {
  const { dir, url, api, attemptId, finish, status } = await backend();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', resolve('src/integrations/mcp.ts')],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      DATA_DIR: dir,
      PORT: new URL(url).port,
    },
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'hermes-stand-in', version: '1' },
    { capabilities: { sampling: {} } },
  );
  const asked: string[] = [];
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const content = request.params.messages[0]!.content;
    asked.push(!Array.isArray(content) && content.type === 'text' ? content.text : '');
    return {
      role: 'assistant',
      model: 'stand-in',
      content: { type: 'text', text: 'Summary:\nSolid solve.' },
    };
  });
  await client.connect(transport);
  cleanups.push(() => client.close());
  await finish(true);
  for (let i = 0; i < 60 && (await status()).status !== 'done'; i++)
    await new Promise((r) => setTimeout(r, 250));
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('Two Sum');
  expect(((await api.request('GET', `/api/attempts/${attemptId}`)) as Attempt).feedback).toBe(
    'Summary:\nSolid solve.',
  );
}, 30000);

test('sampling adapter builds a learning report after prioritizing the immediate review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-learning-mcp-'));
  const app = await createApp({
    dbPath: join(dir, 'leetcode.sqlite'),
    embed: async (texts) =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
  });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  const { openDb } = await import('../../src/server/db/db.js');
  const { Store } = await import('../../src/server/db/store.js');
  const topicDb = openDb(join(dir, 'leetcode.sqlite'));
  new Store(topicDb.sqlite).put('topics', {
    id: 'arrays',
    name: 'Arrays',
    score: 2,
    version: 1,
    notes: '',
    lastReviewed: null,
    provisional: true,
    lastMovement: null,
  });
  topicDb.sqlite.close();
  const client = new Client(
    { name: 'learning-test', version: '1.0.0' },
    { capabilities: { sampling: {} } },
  );
  const phases: string[] = [];
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const prompt = request.params.systemPrompt ?? '';
    let text: string;
    if (prompt.includes('Select the three topics')) {
      phases.push('topics');
      text = JSON.stringify({
        topics: [{ topicNumber: 1, reason: 'Arrays is below the 4/5 target.' }],
      });
    } else if (prompt.includes('ONE completed')) {
      phases.push('extract');
      text = JSON.stringify({
        observations: [
          {
            summary: 'The learner reports forgetting an empty input.',
            polarity: 'difficulty',
            evidenceType: 'learner_reported',
            sourceField: 'notes',
            excerpt: 'Forgot empty input.',
          },
        ],
        limitation: 'Self-reported; no test execution.',
      });
    } else if (prompt.includes('learning report')) {
      phases.push('report');
      const block = request.params.messages[0].content;
      const content = Array.isArray(block) ? block[0] : block;
      const { context } = JSON.parse(content.type === 'text' ? content.text : '{}');
      text = JSON.stringify({
        findings: [
          {
            title: 'Check boundary cases',
            kind: 'single_problem',
            explanation: 'This attempt reports forgetting an empty input.',
            action: 'Check whether empty input is permitted before submitting.',
            evidenceIds: [context.evidence[0].id],
            caveat: 'One self-report is not a recurring pattern.',
            suggestions: [],
          },
        ],
        limitation: 'One attempt analyzed.',
      });
    } else {
      phases.push('review');
      text = 'Summary:\nReview saved before learning analysis.';
    }
    return {
      role: 'assistant' as const,
      content: { type: 'text' as const, text },
      model: 'test-sampling-model',
      stopReason: 'endTurn',
    };
  });
  try {
    const p = (await api.request('POST', '/api/problems', {
      title: 'Boundary',
      url: 'https://leetcode.com/problems/boundary/',
    })) as { id: string };
    const a = (await api.request('POST', '/api/attempts', {
      problemId: p.id,
      context: 'targeted',
    })) as Attempt;
    await api.request(
      'POST',
      `/api/attempts/${a.id}/finish`,
      {
        version: a.version,
        outcome: 'solved',
        help: 'none',
        activeSeconds: 60,
        code: 'return []',
        notes: 'Forgot empty input.',
        requestReview: true,
      },
      `finish-${a.id}`,
    );
    await api.request('POST', '/api/insights/enable', { enabled: true });
    await api.request('POST', '/api/topics/analysis/enable', { enabled: true });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', resolve('src/integrations/mcp.ts')],
        env: {
          ...process.env,
          DATA_DIR: dir,
          PORT: new URL(url).port,
          TUTOR_AUTO_REVIEW: '1',
        } as Record<string, string>,
        stderr: 'pipe',
      }),
    );
    let report: unknown;
    for (let i = 0; i < 160; i++) {
      const status = (await api.request('GET', '/api/insights')) as { report: unknown };
      if (status.report) {
        report = status.report;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(report).toMatchObject({
      model: 'test-sampling-model',
      analyzed: 1,
      findings: [{ kind: 'single_problem' }],
    });
    expect(await api.request('GET', '/api/mcp/status')).toMatchObject({
      state: 'connected',
      sampling: true,
      automaticReviews: true,
    });
    expect(phases.filter((p) => p !== 'topics')[0]).toBe('review');
    expect(phases).toContain('extract');
    expect(phases).toContain('report');
    expect(phases).toContain('topics');
    expect(await api.request('GET', '/api/topics/analysis')).toMatchObject({
      report: { topicIds: ['arrays'], reasons: ['Arrays is below the 4/5 target.'] },
    });
    expect(report).not.toHaveProperty('topicPriorities');
  } finally {
    await client.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
