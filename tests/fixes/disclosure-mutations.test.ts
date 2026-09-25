import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import type { ImportPayload, Problem } from '../../src/shared/contracts.js';

let app: Awaited<ReturnType<typeof createApp>>;
let dir: string;
const token = 'disclosure-test-only';
const clock = () => new Date('2026-09-16T01:00:00Z');
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, extra = {}) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...extra },
    ...(payload === undefined ? {} : { payload }),
  });
const batch = (): ImportPayload => ({
  importId: 'disclosure',
  dryRun: false,
  source: { retrievedAt: clock().toISOString() },
  problems: [
    {
      key: 'p',
      title: 'Question',
      url: 'https://leetcode.com/problems/question/',
      tags: ['Arrays'],
      notes: 'Use a lookup table',
      lists: ['Array practice'],
    },
  ],
  topics: [{ name: 'Arrays', score: 3, notes: '', provisional: false }],
  attempts: [],
  movements: [],
  planned: [],
  records: [],
});
const tables = async () => (await request('GET', '/api/export')).json().tables;
async function importUnexposed() {
  expect((await request('POST', '/api/import', batch())).statusCode).toBe(200);
  const plan = await request('POST', '/api/daily-plan/ensure', {});
  expect(plan.statusCode).toBe(200);
  const problemId: string = plan.json().items[0].problemId;
  expect((await tables()).problems[0]).toMatchObject({ id: problemId, exposed: false });
  return problemId;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lc-disclosure-mutations-'));
  app = await createApp({ dbPath: join(dir, 'test.sqlite'), token, clock });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function expectDurableDisclosure(problem: Problem) {
  expect(problem).toMatchObject({
    exposed: true,
    notes: 'Use a lookup table',
    tags: [expect.objectContaining({ name: 'Arrays' })],
    lists: [expect.objectContaining({ name: 'Array practice' })],
  });
  const before = await tables();
  expect(before.problems.find((p: Problem) => p.id === problem.id)?.exposed).toBe(true);
  expect(before.audit_events).toEqual([
    expect.objectContaining({
      action: 'disclose_problem',
      problemId: problem.id,
      recordedAt: clock().toISOString(),
    }),
  ]);
  for (const table of ['attempts', 'answer_versions', 'score_decisions', 'attempt_topics'])
    expect(before[table]).toEqual([]);
  expect(before.topics[0].score).toBe(3);
  // Returning the same metadata again must not duplicate disclosure evidence.
  expect((await request('PATCH', `/api/problems/${problem.id}`, {})).statusCode).toBe(200);
  expect((await tables()).audit_events).toEqual(before.audit_events);
  await app.close();
  app = await createApp({ dbPath: join(dir, 'test.sqlite'), token, clock });
  const started = await request('POST', '/api/attempts', {
    problemId: problem.id,
    context: 'mixed',
  });
  expect(started.statusCode).toBe(200);
  const attempt = started.json();
  expect(attempt.evidence).toBe('retention');
  const finished = await request(
    'POST',
    `/api/attempts/${attempt.id}/finish`,
    { version: attempt.version, outcome: 'solved', help: 'none', activeSeconds: 600 },
    { 'idempotency-key': 'disclosure-finish' },
  );
  expect(finished.statusCode).toBe(200);
  const topic = (await request('GET', '/api/topics')).json()[0];
  const reviewed = await request(
    'POST',
    `/api/attempts/${attempt.id}/reviews`,
    {
      version: finished.json().version,
      feedback: 'Previously disclosed metadata',
      decisions: [
        {
          topicId: topic.id,
          expectedVersion: topic.version,
          oldScore: 3,
          newScore: 4,
          rationale: 'Must not count as unseen',
          evidence: 'unseen',
        },
      ],
    },
    { 'idempotency-key': 'disclosure-review' },
  );
  expect(reviewed.statusCode).toBe(400);
  expect(reviewed.json().error.code).toBe('EVIDENCE');
  const after = await tables();
  expect(after.topics[0].score).toBe(3);
  expect(after.score_decisions).toEqual([]);
}

it.each(['meaningful', 'no-op'] as const)(
  'PATCH %s metadata response durably prevents unseen scoring',
  async (kind) => {
    const id = await importUnexposed();
    const response = await request(
      'PATCH',
      `/api/problems/${id}`,
      kind === 'meaningful' ? { title: 'Renamed question' } : {},
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().title).toBe(kind === 'meaningful' ? 'Renamed question' : 'Question');
    await expectDurableDisclosure(response.json());
  },
);

it.each(['new', 'duplicate'] as const)(
  'POST %s metadata response durably prevents unseen scoring',
  async (kind) => {
    let payload: object;
    let expectedId: string | undefined;
    if (kind === 'duplicate') {
      expectedId = await importUnexposed();
      payload = { title: 'Duplicate', url: batch().problems[0]!.url };
    } else {
      const seed = batch();
      seed.problems = [];
      expect((await request('POST', '/api/import', seed)).statusCode).toBe(200);
      const tag = await request('POST', '/api/tags', { name: 'Arrays' });
      const list = await request('POST', '/api/lists', { name: 'Array practice' });
      expect(tag.statusCode).toBe(200);
      expect(list.statusCode).toBe(200);
      payload = {
        title: 'Question',
        url: batch().problems[0]!.url,
        notes: 'Use a lookup table',
        tags: [{ tagId: tag.json().id }],
        listIds: [list.json().id],
      };
    }
    const response = await request('POST', '/api/problems', payload);
    expect(response.statusCode).toBe(200);
    if (expectedId) expect(response.json().id).toBe(expectedId);
    await expectDurableDisclosure(response.json());
  },
);
