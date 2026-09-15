import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';
import type { ImportPayload, Problem } from '../../src/shared/contracts.js';

let app: Awaited<ReturnType<typeof createApp>>;
let dir: string;
const token = 'disclosure-test-only';
const clock = () => new Date('2026-09-16T01:00:00Z');
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, extra = {}) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...extra }, ...(payload === undefined ? {} : { payload }) });
const batch = (): ImportPayload => ({
  importId: 'disclosure', dryRun: false, source: { retrievedAt: clock().toISOString() },
  problems: [{ key: 'p', title: 'Question', url: 'https://leetcode.com/problems/question/', tags: ['Arrays'], notes: 'Use a lookup table', lists: ['Array practice'] }],
  topics: [{ name: 'Arrays', score: 3, notes: '', provisional: false }],
  attempts: [], movements: [], planned: [], records: [],
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
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

async function expectDurableDisclosure(problem: Problem) {
  expect(problem).toMatchObject({ exposed: true, notes: 'Use a lookup table', tags: [expect.objectContaining({ name: 'Arrays' })], lists: [expect.objectContaining({ name: 'Array practice' })] });
  const before = await tables();
  expect(before.problems.find((p: Problem) => p.id === problem.id)?.exposed).toBe(true);
  expect(before.audit_events).toEqual([expect.objectContaining({ action: 'disclose_problem', problemId: problem.id, recordedAt: clock().toISOString() })]);
  for (const table of ['attempts', 'answer_versions', 'score_decisions', 'attempt_topics']) expect(before[table]).toEqual([]);
  expect(before.topics[0].score).toBe(3);
  // Returning the same metadata again must not duplicate disclosure evidence.
  expect((await request('PATCH', `/api/problems/${problem.id}`, {})).statusCode).toBe(200);
  expect((await tables()).audit_events).toEqual(before.audit_events);
  await app.close();
  app = await createApp({ dbPath: join(dir, 'test.sqlite'), token, clock });
  const started = await request('POST', '/api/attempts', { problemId: problem.id, context: 'mixed' });
  expect(started.statusCode).toBe(200);
  const attempt = started.json();
  expect(attempt.evidence).toBe('retention');
  const finished = await request('POST', `/api/attempts/${attempt.id}/finish`, { version: attempt.version, outcome: 'solved', help: 'none', activeSeconds: 600 }, { 'idempotency-key': 'disclosure-finish' });
  expect(finished.statusCode).toBe(200);
  const topic = (await request('GET', '/api/topics')).json()[0];
  const reviewed = await request('POST', `/api/attempts/${attempt.id}/reviews`, {
    version: finished.json().version, feedback: 'Previously disclosed metadata',
    decisions: [{ topicId: topic.id, expectedVersion: topic.version, oldScore: 3, newScore: 4, rationale: 'Must not count as unseen', evidence: 'unseen' }],
  }, { 'idempotency-key': 'disclosure-review' });
  expect(reviewed.statusCode).toBe(400);
  expect(reviewed.json().error.code).toBe('EVIDENCE');
  const after = await tables();
  expect(after.topics[0].score).toBe(3);
  expect(after.score_decisions).toEqual([]);
}

it.each(['meaningful', 'no-op'] as const)('PATCH %s metadata response durably prevents unseen scoring', async (kind) => {
  const id = await importUnexposed();
  const response = await request('PATCH', `/api/problems/${id}`, kind === 'meaningful' ? { title: 'Renamed question' } : {});
  expect(response.statusCode).toBe(200);
  expect(response.json().title).toBe(kind === 'meaningful' ? 'Renamed question' : 'Question');
  await expectDurableDisclosure(response.json());
});

it.each(['new', 'duplicate'] as const)('POST %s metadata response durably prevents unseen scoring', async (kind) => {
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
    payload = { title: 'Question', url: batch().problems[0]!.url, notes: 'Use a lookup table', tags: [{ tagId: tag.json().id }], listIds: [list.json().id] };
  }
  const response = await request('POST', '/api/problems', payload);
  expect(response.statusCode).toBe(200);
  if (expectedId) expect(response.json().id).toBe(expectedId);
  await expectDurableDisclosure(response.json());
});

it.each(['active', 'paused'] as const)('denies metadata mutations during %s mixed assessment without recording disclosure', async (status) => {
  const id = await importUnexposed();
  const started = await request('POST', '/api/attempts', { problemId: id, context: 'mixed' });
  expect(started.statusCode).toBe(200);
  const attempt = started.json();
  expect(attempt.evidence).toBe('unseen');
  if (status === 'paused') expect((await request('POST', `/api/attempts/${attempt.id}/timer`, { version: attempt.version, action: 'pause' })).statusCode).toBe(200);
  const before = await tables();
  expect(before.audit_events).toEqual([]);
  for (const [method, url, payload] of [
    ['POST', '/api/problems', { title: 'Duplicate', url: batch().problems[0]!.url }],
    ['PATCH', `/api/problems/${id}`, { title: 'Renamed' }],
    ['PATCH', `/api/problems/${id}`, {}],
  ] as const) {
    const denied = await request(method, url, payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('HIDDEN_ASSESSMENT');
    expect(denied.body).not.toMatch(/Arrays|lookup table|Array practice/);
    expect(await tables()).toEqual(before);
  }
});

it.each(['POST new', 'POST duplicate', 'PATCH'] as const)('%s failed mutations leave no disclosure or partial writes', async (kind) => {
  const id = await importUnexposed();
  const before = await tables();
  const method = kind === 'PATCH' ? 'PATCH' : 'POST';
  const url = kind === 'PATCH' ? `/api/problems/${id}` : '/api/problems';
  const base = { title: 'Changed', ...(kind === 'PATCH' ? {} : { url: kind === 'POST new' ? 'https://leetcode.com/problems/new-question/' : batch().problems[0]!.url }) };
  for (const [payload, expectedStatus] of [
    [{ ...base, title: '' }, 400],
    [{ ...base, tags: [{ tagId: 'missing-tag' }] }, 404],
    // Link removal occurs before the missing list is found; it must roll back too.
    [{ ...base, tags: [], listIds: ['missing-list'] }, 404],
  ] as const) {
    const failed = await request(method, url, payload);
    expect(failed.statusCode).toBe(expectedStatus);
    expect(failed.body).not.toMatch(/Arrays|lookup table|Array practice/);
    expect(await tables()).toEqual(before);
  }
  const missing = await request('PATCH', '/api/problems/missing-problem', { title: 'Missing' });
  expect(missing.statusCode).toBe(404);
  expect(await tables()).toEqual(before);
});

it('does not invent disclosure for metadata-free POST or PATCH responses', async () => {
  const payload = { title: 'Plain', url: 'https://leetcode.com/problems/plain/' };
  const created = await request('POST', '/api/problems', payload);
  expect(created.statusCode).toBe(200);
  const id = created.json().id;
  for (const response of [created, await request('POST', '/api/problems', payload), await request('PATCH', `/api/problems/${id}`, { title: 'Renamed' }), await request('PATCH', `/api/problems/${id}`, {})]) {
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ exposed: false, notes: '', tags: [], lists: [] });
  }
  const saved = await tables();
  expect(saved.problems[0].exposed).toBe(false);
  for (const table of ['audit_events', 'attempts', 'answer_versions', 'score_decisions']) expect(saved[table]).toEqual([]);
});

it.each(['POST', 'PATCH'] as const)('%s treats each individual metadata kind as disclosure', async (method) => {
  const tag = (await request('POST', '/api/tags', { name: 'Arrays' })).json();
  const list = (await request('POST', '/api/lists', { name: 'Array practice' })).json();
  for (const [kind, metadata] of [
    ['notes', { notes: 'Use a lookup table' }],
    ['tags', { tags: [{ tagId: tag.id }] }],
    ['lists', { listIds: [list.id] }],
  ] as const) {
    const base = { title: kind, url: `https://leetcode.com/problems/${kind}/` };
    let response;
    if (method === 'POST') response = await request('POST', '/api/problems', { ...base, ...metadata });
    else {
      const created = await request('POST', '/api/problems', base);
      expect(created.statusCode).toBe(200);
      expect(created.json().exposed).toBe(false);
      response = await request('PATCH', `/api/problems/${created.json().id}`, metadata);
    }
    expect(response.statusCode).toBe(200);
    expect(response.json().exposed).toBe(true);
    const saved = await tables();
    expect(saved.problems.find((p: Problem) => p.id === response.json().id)?.exposed).toBe(true);
    expect(saved.audit_events).toContainEqual(expect.objectContaining({ action: 'disclose_problem', problemId: response.json().id }));
  }
});
