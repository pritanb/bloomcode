import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import { sameTables } from '../../src/integrations/snapshot.js';
import type { Attempt, Snapshot } from '../../src/shared/contracts.js';
let app: Awaited<ReturnType<typeof createApp>>;
const clock = () => new Date('2026-09-16T01:00:00Z');
const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, key?: string) =>
  app.inject({
    method,
    url,
    headers: { authorization: 'Bearer test', ...(key ? { 'idempotency-key': key } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
beforeEach(async () => {
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
});
afterEach(async () => {
  await app.close();
});
async function problem(slug = 'example') {
  return (
    await request('POST', '/api/problems', {
      title: slug,
      url: `https://leetcode.com/problems/${slug}/`,
    })
  ).json();
}
async function start(problemId: string, context = 'targeted'): Promise<Attempt> {
  return (await request('POST', '/api/attempts', { problemId, context })).json();
}
async function finish(a: Attempt): Promise<Attempt> {
  return (
    await request(
      'POST',
      `/api/attempts/${a.id}/finish`,
      { version: a.version, outcome: 'solved', help: 'none', activeSeconds: 60, code: 'return 1' },
      `finish-${a.id}`,
    )
  ).json();
}
const pattern = (ids: string[] = []) => ({
  title: 'Two pointers',
  recognitionCues: 'Sorted input',
  pitfalls: 'Moving both pointers',
  notes: 'Check bounds',
  exampleProblemIds: ids,
});
it('saves reflections separately, rejects stale/unfinished edits and protects mixed history', async () => {
  const p = await problem();
  let a = await start(p.id);
  const reflection = { mistakeLabels: ['missed_edge_case'], takeaway: 'Check an empty input' };
  expect(
    (
      await request('PATCH', `/api/attempts/${a.id}/reflection`, {
        version: a.version,
        ...reflection,
      })
    ).statusCode,
  ).toBe(409);
  a = await finish(a);
  const before = (await request('GET', '/api/export')).json<Snapshot>();
  const saved = await request('PATCH', `/api/attempts/${a.id}/reflection`, {
    version: a.version,
    ...reflection,
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    ...reflection,
    version: a.version + 1,
    code: a.code,
    activeSeconds: a.activeSeconds,
  });
  expect(
    (
      await request('PATCH', `/api/attempts/${a.id}/reflection`, {
        version: a.version,
        ...reflection,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await request('GET', '/api/mistakes?q=empty&label=missed_edge_case')).json(),
  ).toHaveLength(1);
  const after = (await request('GET', '/api/export')).json<Snapshot>();
  for (const key of ['problems', 'review_targets', 'score_decisions', 'answer_versions'])
    expect(after.tables[key]).toEqual(before.tables[key]);
  let mixed = await start((await problem('fresh')).id, 'mixed');
  for (const path of ['/api/mistakes', '/api/patterns', `/api/attempts/${a.id}/context`])
    expect((await request('GET', path)).statusCode).toBe(403);
  mixed = (
    await request('POST', `/api/attempts/${mixed.id}/timer`, {
      version: mixed.version,
      action: 'pause',
    })
  ).json();
  expect((await request('GET', `/api/attempts/${a.id}/context`)).statusCode).toBe(403);
  expect((await request('GET', '/api/recap')).json()).toMatchObject({
    completedAttempts: 1,
    independentSolves: 1,
    detailsHidden: true,
    attempts: [],
    movements: [],
  });
  const hiddenDashboard = (await request('GET', '/api/dashboard')).json();
  expect(hiddenDashboard.latestReflection).toBeNull();
  expect(hiddenDashboard.recentAttempts[0]).not.toHaveProperty('takeaway');
  expect(hiddenDashboard.recentAttempts[0]).not.toHaveProperty('mistakeLabels');
  expect((await request('GET', `/api/attempts/${a.id}`)).json()).not.toHaveProperty('takeaway');
  await finish(mixed);
  expect((await request('GET', `/api/attempts/${a.id}/context`)).statusCode).toBe(200);
});
it('keeps notebook notes on pattern tags, derives assigned questions, and keeps LeetCode topics separate', async () => {
  const p = await problem();
  const tag = (
    await request('POST', '/api/tags', { name: 'Binary Search on Answer Space' })
  ).json();
  const question = await request('PATCH', `/api/problems/${p.id}`, {
    leetcodeTopics: ['Binary Search'],
    tags: [{ tagId: tag.id, difficulty: 6 }],
  });
  expect(question.json()).toMatchObject({
    leetcodeTopics: ['Binary Search'],
    tags: [{ id: tag.id, difficulty: 6 }],
  });
  const before = (await request('GET', '/api/export')).json<Snapshot>();
  expect((await request('GET', `/api/patterns/${tag.id}`)).json()).toMatchObject({
    id: tag.id,
    title: tag.name,
    version: 1,
    examples: [{ id: p.id, patternDifficulty: 6 }],
  });
  const notes = {
    recognitionCues: 'Monotonic feasibility check',
    pitfalls: 'Incorrect bounds',
    notes: 'Find the first feasible answer',
  };
  expect(
    (await request('PATCH', `/api/patterns/${tag.id}`, { version: 1, ...notes })).statusCode,
  ).toBe(200);
  expect(
    (await request('PATCH', `/api/patterns/${tag.id}`, { version: 1, ...notes })).statusCode,
  ).toBe(409);
  expect((await request('GET', '/api/patterns?q=Monotonic')).json()).toMatchObject([
    { id: tag.id },
  ]);
  expect((await request('GET', '/api/problems?leetcodeTopic=Binary%20Search')).json().total).toBe(
    1,
  );
  expect((await request('GET', '/api/topics')).json()).toEqual([]);
  expect((await request('POST', '/api/patterns', pattern())).statusCode).toBe(404);
  expect((await request('GET', '/api/tags')).json()[0]).not.toHaveProperty('recognitionCues');
  expect((await request('GET', `/api/problems/${p.id}`)).json().problem.tags[0]).not.toHaveProperty(
    'patternNotes',
  );
  await request('PATCH', `/api/tags/${tag.id}`, { name: 'Answer-space search', archived: true });
  expect((await request('GET', `/api/patterns/${tag.id}`)).json()).toMatchObject({
    title: 'Answer-space search',
    archived: true,
    ...notes,
  });
  const full = (await request('GET', '/api/export')).json<Snapshot>();
  expect(full.schemaVersion).toBe(4);
  for (const table of ['topics', 'score_decisions', 'review_targets', 'attempts'])
    expect(full.tables[table]).toEqual(before.tables[table]);
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: full })).statusCode,
  ).toBe(200);
  expect(sameTables(full, (await request('GET', '/api/export')).json())).toBe(true);
  await request('PATCH', `/api/problems/${p.id}`, { tags: [] });
  expect((await request('GET', `/api/patterns/${tag.id}`)).json().examples).toEqual([]);
  expect((await request('GET', `/api/problems/${p.id}`)).json().problem.leetcodeTopics).toEqual([
    'Binary Search',
  ]);
  const mixed = await start(p.id, 'mixed');
  expect((await request('GET', `/api/patterns/${tag.id}`)).statusCode).toBe(403);
  expect(
    (await request('PATCH', `/api/patterns/${tag.id}`, { version: 2, ...notes })).statusCode,
  ).toBe(403);
  await finish(mixed);
});

it('consolidates v2 notebook records losslessly and restores v1 snapshots', async () => {
  const p = await problem();
  const other = await problem('other');
  const tag = (
    await request('POST', '/api/tags', {
      name: 'Two pointers',
      description: 'Existing description',
    })
  ).json();
  await request('PATCH', `/api/problems/${p.id}`, { tags: [{ tagId: tag.id, difficulty: 7 }] });
  const completed = await finish(await start(p.id));
  const old = (await request('GET', '/api/export')).json<Snapshot>();
  old.schemaVersion = 2;
  delete old.tables.learning_insights;
  old.tables.patterns = [
    {
      id: 'old',
      ...pattern([p.id, other.id]),
      version: 1,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    },
    {
      id: 'duplicate',
      ...pattern([p.id]),
      notes: 'Second lesson',
      version: 1,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    },
    {
      id: 'new',
      ...pattern([other.id]),
      title: 'Answer space',
      version: 1,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    },
  ];
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  const invalid = structuredClone(old);
  invalid.tables.patterns![0]!.exampleProblemIds = ['missing'];
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: invalid })).statusCode,
  ).toBe(400);
  expect((await request('GET', '/api/export')).json().tables.problems).toEqual([]);
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: old })).statusCode,
  ).toBe(200);
  const migrated = (await request('GET', '/api/export')).json<Snapshot>();
  expect(sameTables(old, migrated)).toBe(true);
  expect(migrated.tables.patterns).toEqual([]);
  expect(migrated.tables.tags).toHaveLength(2);
  expect(migrated.tables.tags!.find((row) => row.id === tag.id)).toMatchObject({
    description: 'Existing description',
    patternNotes: 'Check bounds\n\nSecond lesson',
  });
  expect(
    migrated.tables.problem_tags!.find((row) => row.problemId === p.id && row.tagId === tag.id)!
      .difficulty,
  ).toBe(7);
  expect((await request('GET', `/api/attempts/${completed.id}`)).json()).toEqual(completed);
  for (const table of ['problems', 'topics', 'score_decisions', 'review_targets', 'audit_events'])
    expect(migrated.tables[table]).toEqual(old.tables[table]);
  const legacy = structuredClone(old);
  legacy.schemaVersion = 1;
  delete legacy.tables.patterns;
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: legacy })).statusCode,
  ).toBe(200);
  expect(sameTables(legacy, (await request('GET', '/api/export')).json())).toBe(true);
});
it('attributes recap and activity by study date and only counts assigned scheduled reviews', async () => {
  const p = await problem();
  await finish(await start(p.id, 'review'));
  const snapshot = (await request('GET', '/api/export')).json<Snapshot>();
  const attempt = snapshot.tables.attempts![0]!;
  attempt.studyDate = '2026-09-14';
  for (let i = 0; i < 25; i++)
    snapshot.tables.attempts!.push({
      ...attempt,
      id: `previous-week-${i}`,
      studyDate: '2026-09-13',
    });
  snapshot.tables.daily_plans!.push({
    id: 'plan',
    date: '2026-09-14',
    timezone: 'Australia/Sydney',
    version: 1,
  });
  snapshot.tables.plan_items!.push({
    id: 'item',
    planId: 'plan',
    position: 0,
    problemId: p.id,
    title: p.title,
    url: p.url,
    status: 'completed',
    reason: 'Scheduled review',
    suggestedMinutes: 20,
    attemptId: 'scheduled',
  });
  snapshot.tables.attempts!.push({
    ...attempt,
    id: 'scheduled',
    planItemId: 'item',
    help: 'small',
  });
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  expect((await request('POST', '/api/restore', { confirmEmpty: true, snapshot })).statusCode).toBe(
    200,
  );
  const recap = (await request('GET', '/api/recap?week=2026-09-16')).json();
  expect(recap).toMatchObject({
    weekStart: '2026-09-14',
    weekEnd: '2026-09-20',
    completedAttempts: 2,
    distinctQuestions: 1,
    independentSolves: 1,
    scheduledReviews: 1,
    detailsHidden: false,
  });
  const dashboard = (await request('GET', '/api/dashboard')).json();
  expect(dashboard.activity).toHaveLength(28);
  expect(
    dashboard.activity.find((d: { date: string }) => d.date === '2026-09-13').completedAttempts,
  ).toBe(25);
  expect(
    dashboard.activity.find((d: { date: string }) => d.date === '2026-09-14').completedAttempts,
  ).toBe(2);
  expect(dashboard.activity.at(-1)).toEqual({ date: '2026-09-16', completedAttempts: 0 });
});

it('upgrades an on-disk v1 database without changing saved work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-pattern-migration-'));
  try {
    await app.close();
    const dbPath = join(dir, 'test.sqlite');
    app = await createApp({ dbPath, token: 'test', clock });
    const p = await problem();
    const a = await finish(await start(p.id));
    const original = (await request('GET', '/api/export')).json<Snapshot>();
    await app.close();
    const sql = new Database(dbPath);
    sql.exec('DROP TABLE patterns; DROP TABLE learning_insights; DROP TABLE insight_embeddings');
    sql.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(1789516800001);
    sql.close();
    app = await createApp({ dbPath, token: 'test', clock });
    expect((await request('GET', `/api/attempts/${a.id}`)).json()).toEqual(a);
    expect((await request('GET', '/api/patterns')).json()).toEqual([]);
    expect(sameTables(original, (await request('GET', '/api/export')).json())).toBe(true);
    await app.close();
    const oldDb = new Database(dbPath);
    oldDb.prepare('INSERT INTO patterns(id,data) VALUES (?,?)').run(
      'old-notebook',
      JSON.stringify({
        id: 'old-notebook',
        ...pattern([p.id]),
        version: 1,
        createdAt: clock().toISOString(),
        updatedAt: clock().toISOString(),
      }),
    );
    oldDb.close();
    app = await createApp({ dbPath, token: 'test', clock });
    const consolidated = (await request('GET', '/api/export')).json<Snapshot>();
    expect(consolidated.tables.patterns).toEqual([]);
    expect(consolidated.tables.tags![0]).toMatchObject({
      name: 'Two pointers',
      patternNotes: 'Check bounds',
    });
    expect((await request('GET', `/api/attempts/${a.id}`)).json()).toEqual(a);
    await app.close();
    app = await createApp({ dbPath, token: 'test', clock });
    expect(sameTables(consolidated, (await request('GET', '/api/export')).json())).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  }
});

it('gives every tag a notebook regardless of former classification and preserves backups', async () => {
  const p = await problem();
  const broad = (await request('POST', '/api/tags', { name: 'Binary Search' })).json();
  const technique = (
    await request('POST', '/api/tags', { name: 'Binary Search on Answer Space' })
  ).json();
  await request('PATCH', `/api/problems/${p.id}`, {
    tags: [
      { tagId: broad.id, difficulty: 4 },
      { tagId: technique.id, difficulty: 7 },
    ],
  });
  await request('PATCH', `/api/patterns/${broad.id}`, {
    version: 1,
    recognitionCues: 'Retained cue',
    pitfalls: '',
    notes: 'Saved before correction',
  });
  const legacy = (await request('GET', '/api/export')).json<Snapshot>();
  legacy.tables.tags!.find((tag) => tag.id === broad.id)!.kind = 'topic';
  delete legacy.tables.tags!.find((tag) => tag.id === technique.id)!.kind;
  legacy.tables.import_batches!.push({
    id: 'lists-v2-fixture',
    fingerprint: 'a'.repeat(64),
    source: { retrievedAt: clock().toISOString() },
    appliedAt: clock().toISOString(),
    evidence: {
      problems: [{ key: 'example', title: p.title, url: p.url, tags: ['Binary Search'] }],
      attempts: [],
      movements: [],
    },
  });
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: legacy })).statusCode,
  ).toBe(200);
  expect((await request('GET', '/api/patterns')).json()).toMatchObject([
    { id: broad.id },
    { id: technique.id },
  ]);
  expect((await request('GET', `/api/patterns/${broad.id}`)).json()).toMatchObject({
    notes: 'Saved before correction',
    examples: [{ id: p.id, patternDifficulty: 4 }],
  });
  expect(
    (
      await request('PATCH', `/api/patterns/${broad.id}`, {
        version: 1,
        recognitionCues: '',
        pitfalls: '',
        notes: 'overwrite',
      })
    ).statusCode,
  ).toBe(409);
  expect((await request('GET', '/api/problems?leetcodeTopic=Binary%20Search')).json().total).toBe(
    1,
  );
  const migrated = (await request('GET', '/api/export')).json<Snapshot>();
  expect(sameTables(legacy, migrated)).toBe(true);
  expect(migrated.tables.problem_tags).toEqual(legacy.tables.problem_tags);
  expect(migrated.tables.tags!.find((t) => t.id === broad.id)).toMatchObject({
    kind: 'topic',
    patternNotes: 'Saved before correction',
  });
  for (const table of ['topics', 'score_decisions', 'attempts', 'review_targets'])
    expect(migrated.tables[table]).toEqual(legacy.tables[table]);
  await request('PATCH', `/api/tags/${broad.id}`, { kind: 'pattern' });
  expect((await request('GET', `/api/patterns/${broad.id}`)).json()).toMatchObject({
    notes: 'Saved before correction',
    examples: [{ id: p.id, patternDifficulty: 4 }],
  });
  const corrected = (await request('GET', '/api/export')).json<Snapshot>();
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', clock });
  expect(
    (await request('POST', '/api/restore', { confirmEmpty: true, snapshot: corrected })).statusCode,
  ).toBe(200);
  expect((await request('GET', '/api/patterns')).json()).toHaveLength(2);
});
