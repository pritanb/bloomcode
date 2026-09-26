// Builds tests/server/fixtures/schema-v3.sqlite with the pre-relational (JSON column) code and
// records every read endpoint's response to schema-v3-responses.json. The relational-schema
// migration test opens a copy of that database with the new code and expects identical
// responses. Run once, on the JSON-column code: npx tsx tests/server/fixtures/build-schema-fixture.ts
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../src/server/core/app.js';
import { readEndpoints, FIXTURE_CLOCK } from './schema-fixture-reads.js';

const here = new URL('.', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'lc-schema-fixture-'));
const dbPath = join(dir, 'fixture.sqlite');
let now = new Date('2026-09-14T01:00:00Z');
let app = await createApp({ dbPath, token: 't', clock: () => now });
let keys = 0;
async function call(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, key = false) {
  const res = await app.inject({
    method,
    url,
    headers: {
      authorization: 'Bearer t',
      ...(key ? { 'idempotency-key': `fixture-${++keys}` } : {}),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} ${res.statusCode} ${res.body}`);
  return res.json();
}
const later = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));

// Onboarding with a real list, then the retired Sheet import for legacy evidence.
await call('POST', '/api/setup', {
  timezone: 'Australia/Sydney',
  questionsPerDay: 3,
  list: 'NeetCode 150',
});
const sheet = JSON.parse(
  readFileSync(join(here, '../../integrations/fixtures/sheet-evidence-import.json'), 'utf8'),
);
await call('POST', '/api/import', { ...sheet, dryRun: false });

// Catalogue edits: a custom tag, list and problem, a tag colour and a pattern notebook.
const tag = await call('POST', '/api/tags', { name: 'Custom pattern', description: 'Mine' });
await call('PATCH', `/api/tags/${tag.id}`, { hue: 200 });
const personal = await call('POST', '/api/lists', { name: 'Personal', sourceVersion: '1' });
const custom = await call('POST', '/api/problems', {
  title: 'Custom Problem',
  url: 'https://leetcode.com/problems/custom-problem/',
  difficulty: 'Medium',
  leetcodeTopics: ['Array', 'Hash Table'],
  tags: [{ tagId: tag.id }],
  listIds: [personal.id],
});
await call('PATCH', `/api/problems/${custom.id}`, { notes: 'Remember the edge case' });
await call('PATCH', `/api/patterns/${tag.id}`, {
  version: 1,
  recognitionCues: 'Sorted input',
  pitfalls: 'Off by one',
  notes: 'Two pointers',
});

type Attempt = { id: string; version: number };
async function finish(a: Attempt, body: Record<string, unknown>) {
  later(18);
  return call('POST', `/api/attempts/${a.id}/finish`, { version: a.version, ...body }, true);
}

// Day 1: plan, a solved plan attempt with a tutor review and reflection, a skipped item.
let plan = await call('POST', '/api/daily-plan/ensure', {});
let a: Attempt = await call('POST', '/api/attempts', {
  problemId: plan.items[0].problemId,
  planItemId: plan.items[0].id,
  context: 'mixed',
  language: 'python',
});
a = await call('PATCH', `/api/attempts/${a.id}/draft`, {
  version: a.version,
  code: 'def solve(nums):\n    return sorted(nums)',
  notes: 'Sorted first',
});
later(1);
a = await call('POST', `/api/attempts/${a.id}/timer`, { version: a.version, action: 'heartbeat' });
a = await finish(a, { outcome: 'solved', help: 'none', activeSeconds: 1100, confidence: 4 });
const topics: { id: string; version: number; score: number | null }[] = await call(
  'GET',
  '/api/topics',
);
const scored = topics.find((t) => t.score !== null)!;
await call(
  'POST',
  `/api/attempts/${a.id}/reviews`,
  {
    version: a.version,
    feedback: 'Clean solution; explain the sort cost.',
    decisions: [
      {
        topicId: scored.id,
        expectedVersion: scored.version,
        oldScore: scored.score,
        newScore: Math.min(5, scored.score! + 0.1),
        rationale: 'Independent unseen solve',
        evidence: 'unseen',
      },
    ],
  },
  true,
);
const reviewed: Attempt = await call('GET', `/api/attempts/${a.id}`);
await call('PATCH', `/api/attempts/${a.id}/reflection`, {
  version: reviewed.version,
  mistakeLabels: ['missed_edge_case'],
  takeaway: 'Check empty input',
});
await call('POST', `/api/plan-items/${plan.items[2].id}/disposition`, {
  action: 'skip',
  reason: 'Tired',
});

// A failed targeted attempt, then a manual review date.
const b: Attempt = await call('POST', '/api/attempts', {
  problemId: custom.id,
  context: 'targeted',
  language: 'java',
});
await finish(b, { outcome: 'not_solved', help: 'major', activeSeconds: 2400, code: 'class S {}' });
const reviews: { id: string; problemId: string; version: number }[] = await call(
  'GET',
  '/api/reviews',
);
const target = reviews.find((r) => r.problemId === custom.id)!;
await call('PATCH', `/api/reviews/${target.id}`, {
  version: target.version,
  action: 'manual',
  date: '2026-09-20',
});

// A cancelled attempt leaves no evidence.
const c: Attempt = await call('POST', '/api/attempts', { problemId: custom.id, context: 'review' });
await call('POST', `/api/attempts/${c.id}/cancel`, { version: c.version }, true);

// Day 2: a new plan, settings changes, a second solve with help, and a paused attempt.
await app.close();
now = new Date('2026-09-15T02:00:00Z');
app = await createApp({ dbPath, token: 't', clock: () => now });
await call('PATCH', '/api/settings', { budgetMinutes: 60, autoScore: false });
plan = await call('POST', '/api/daily-plan/ensure', {});
const d: Attempt = await call('POST', '/api/attempts', {
  problemId: plan.items[0].problemId,
  planItemId: plan.items[0].id,
  context: 'review',
});
await finish(d, { outcome: 'solved', help: 'small', activeSeconds: 700 });
let e: Attempt = await call('POST', '/api/attempts', {
  problemId: plan.items[1].problemId,
  planItemId: plan.items[1].id,
  context: 'targeted',
});
e = await call('PATCH', `/api/attempts/${e.id}/draft`, { version: e.version, code: 'wip' });
await call('POST', `/api/attempts/${e.id}/timer`, { version: e.version, action: 'pause' });
await app.close();

// Save the database, then record every read at a fixed clock.
copyFileSync(dbPath, join(here, 'schema-v3.sqlite'));
now = FIXTURE_CLOCK;
app = await createApp({ dbPath, token: 't', clock: () => now });
const responses: Record<string, unknown> = {};
for (const url of await readEndpoints((u) => call('GET', u)))
  responses[url] = await call('GET', url);
await app.close();
writeFileSync(join(here, 'schema-v3-responses.json'), JSON.stringify(responses, null, 1));
rmSync(dir, { recursive: true, force: true });
console.log(`Recorded ${Object.keys(responses).length} responses`);
