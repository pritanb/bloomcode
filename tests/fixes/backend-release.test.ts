import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';
import type { ImportPayload } from '../../src/shared/contracts.js';

let app: Awaited<ReturnType<typeof createApp>>;
let dir: string;
const headers = { authorization: 'Bearer fixes-test-only' };
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, extra = {}) =>
  app.inject({ method, url, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { payload }) });
const batch = (): ImportPayload => ({
  importId: 'first', dryRun: false, source: { spreadsheetId: 'sheet', retrievedAt: '2026-09-16T00:00:00+10:00' },
  problems: [{ key: 'p', title: 'Question', url: 'https://leetcode.com/problems/question/', tags: ['Arrays'], notes: 'Use a lookup table', lists: ['Array practice'] }],
  topics: [{ name: 'Arrays', score: 3, notes: '', provisional: false }], attempts: [], movements: [], planned: [], records: [],
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lc-backend-fixes-'));
  app = await createApp({ dbPath: join(dir, 'test.sqlite'), token: 'fixes-test-only', clock: () => new Date('2026-09-16T01:00:00Z') });
});
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

const evidenceBatch = (): ImportPayload => ({
  ...batch(),
  attempts: [{ sourceKey: 'LC:2', problemKey: 'p', date: '2026-09-01', outcome: 'solved', help: 'none', activeSeconds: 600, notes: 'Original source', code: 'return answer', evidence: 'retention', topicNames: ['Arrays'] }],
  movements: [{ sourceKey: 'Ratings:2', topicName: 'Arrays', date: '2026-09-01', oldScore: 2.9, newScore: 3, rationale: 'Original movement', evidence: 'legacy' }],
  records: [{ sourceKey: 'LC:2', tab: 'LC', row: 2, raw: ['Original source', '10m'], status: 'imported' }],
});

it('deduplicates unchanged Sheet evidence across fresh snapshots while retaining each raw snapshot', async () => {
  const b = evidenceBatch();
  expect((await request('POST', '/api/import', b)).statusCode).toBe(200);
  const refresh = { ...b, importId: 'refresh', source: { ...b.source, retrievedAt: '2026-09-17T00:00:00Z' } };
  const before = (await request('GET', '/api/export')).json().tables;
  const dry = await request('POST', '/api/import', { ...refresh, dryRun: true });
  expect(dry.statusCode).toBe(200);
  expect(dry.json().counts).toMatchObject({ attempts: 0, movements: 0 });
  expect((await request('GET', '/api/export')).json().tables).toEqual(before);
  const applied = await request('POST', '/api/import', refresh);
  expect(applied.statusCode).toBe(200);
  expect(applied.json().counts).toMatchObject({ attempts: 0, movements: 0, records: 1 });
  const after = (await request('GET', '/api/export')).json().tables;
  for (const table of ['attempts', 'score_decisions', 'answer_versions', 'attempt_topics', 'problems']) expect(after[table]).toEqual(before[table]);
  expect(after.import_batches).toHaveLength(2);
  expect(after.import_records).toHaveLength(2);
  expect(after.import_records[1]).toMatchObject({ ...b.records[0], importId: 'refresh' });
});

it.each(['attempt', 'movement', 'problem identity', 'unresolved reference'] as const)('rejects changed existing %s evidence atomically across snapshots', async (change) => {
  const b = evidenceBatch();
  await request('POST', '/api/import', b);
  const before = (await request('GET', '/api/export')).json().tables;
  const refresh = structuredClone(b);
  refresh.importId = 'changed';
  refresh.problems.push({ key: 'fresh', title: 'Must roll back', url: 'https://leetcode.com/problems/must-roll-back/' });
  refresh.attempts.unshift({ ...b.attempts[0]!, sourceKey: 'LC:3', problemKey: 'fresh', date: '2026-08-01' });
  if (change === 'attempt') refresh.attempts[1]!.code = 'Changed source answer';
  if (change === 'movement') refresh.movements[0]!.rationale = 'Changed movement';
  if (change === 'problem identity') refresh.problems[0]!.url = 'https://leetcode.com/problems/different/';
  if (change === 'unresolved reference') refresh.movements[0]!.topicName = 'Missing topic';
  expect((await request('POST', '/api/import', refresh)).statusCode).toBe(409);
  expect((await request('GET', '/api/export')).json().tables).toEqual(before);
});

it('refills the same untouched empty generated day after its first question arrives', async () => {
  const empty = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(empty.items).toEqual([]);
  expect((await request('POST', '/api/daily-plan/ensure', {})).json()).toEqual(empty);
  const p = (await request('POST', '/api/problems', { title: 'First', url: 'https://leetcode.com/problems/first/' })).json();
  const filled = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(filled.items).toHaveLength(1);
  expect(filled.id).toBe(empty.id);
  expect(filled.version).toBeGreaterThan(empty.version);
  expect(filled.items[0]).toMatchObject({ problemId: p.id, status: 'active', attemptId: null });
  expect((await request('POST', '/api/daily-plan/ensure', {})).json()).toEqual(filled);
  expect((await request('GET', '/api/export')).json().tables.attempts).toEqual([]);
});

it('records actual catalogue disclosure durably and rejects unseen 3-to-4 scoring', async () => {
  expect((await request('POST', '/api/import', batch())).statusCode).toBe(200);
  const initial = (await request('GET', '/api/export')).json().tables;
  const p = initial.problems[0];
  expect(p.exposed).toBe(false); // Ingestion is not disclosure.
  const tag = initial.tags[0];
  const revealed = (await request('GET', `/api/problems?tags=${tag.id}`)).json().items[0];
  expect(revealed.tags[0].name).toBe('Arrays');
  const a = (await request('POST', '/api/attempts', { problemId: p.id, context: 'mixed' })).json();
  const done = (await request('POST', `/api/attempts/${a.id}/finish`, { version: a.version, outcome: 'solved', help: 'none', activeSeconds: 600 }, { 'idempotency-key': 'finish' })).json();
  const topic = (await request('GET', '/api/topics')).json()[0];
  const review = await request('POST', `/api/attempts/${a.id}/reviews`, { version: done.version, feedback: 'Already disclosed', decisions: [{ topicId: topic.id, expectedVersion: topic.version, oldScore: 3, newScore: 4, rationale: 'Unseen claim', evidence: 'unseen' }] }, { 'idempotency-key': 'review' });
  expect(review.statusCode).toBe(400);
  const tables = (await request('GET', '/api/export')).json().tables;
  expect(tables.topics[0].score).toBe(3);
  expect(tables.score_decisions).toHaveLength(0);
  expect(tables.audit_events).toContainEqual(expect.objectContaining({ action: 'disclose_problem', problemId: p.id }));
});

it('blocks active and paused mixed metadata routes without exposing tags, notes or lists', async () => {
  await request('POST', '/api/import', batch());
  const tables = (await request('GET', '/api/export')).json().tables;
  const p = tables.problems[0];
  const a = (await request('POST', '/api/attempts', { problemId: p.id, context: 'mixed' })).json();
  expect(a.evidence).toBe('unseen');
  expect(JSON.stringify(a)).not.toMatch(/Arrays|lookup table|Array practice/);
  for (const path of ['/api/problems', `/api/problems?tags=${tables.tags[0].id}`, `/api/problems?listId=${tables.lists[0].id}`]) {
    const response = await request('GET', path);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], total: 0 });
  }
  const paths = [`/api/problems/${p.id}`, `/api/topics/${tables.topics[0].id}`, `/api/attempts/${a.id}/context`];
  for (const path of paths) {
    const response = await request('GET', path);
    expect(response.statusCode, path).toBe(403);
    expect(response.body).not.toMatch(/Arrays|lookup table|Array practice/);
  }
  expect((await request('PATCH', `/api/problems/${p.id}`, { title: 'Changed' })).statusCode).toBe(403);
  expect((await request('POST', '/api/problems', { title: 'Duplicate', url: p.url })).statusCode).toBe(403);
  const paused = (await request('POST', `/api/attempts/${a.id}/timer`, { version: a.version, action: 'pause' })).json();
  expect((await request('GET', `/api/problems/${p.id}`)).statusCode).toBe(403);
  const done = (await request('POST', `/api/attempts/${a.id}/finish`, { version: paused.version, outcome: 'solved', help: 'none', activeSeconds: 600 }, { 'idempotency-key': 'hidden-finish' })).json();
  expect(done.evidence).toBe('unseen');
  const detail = await request('GET', `/api/problems/${p.id}`);
  expect(detail.statusCode).toBe(200);
  expect(detail.json().problem.notes).toBe('Use a lookup table');
  expect((await request('GET', `/api/attempts/${a.id}/context`)).statusCode).toBe(200);
});
