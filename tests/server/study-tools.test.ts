import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import type { Attempt } from '../../src/shared/contracts.js';
import { insert, one } from '../../src/server/db/db.js';
import { readTables } from '../tables.js';
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
  const before = readTables(app.tutorJobs.db);
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
  const after = readTables(app.tutorJobs.db);
  for (const key of ['problems', 'review_targets', 'score_decisions'])
    expect(after[key]).toEqual(before[key]);
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
    tags: [{ tagId: tag.id }],
  });
  expect(question.json()).toMatchObject({
    leetcodeTopics: ['Binary Search'],
    tags: [{ id: tag.id }],
  });
  const before = readTables(app.tutorJobs.db);
  expect((await request('GET', `/api/patterns/${tag.id}`)).json()).toMatchObject({
    id: tag.id,
    title: tag.name,
    version: 1,
    examples: [{ id: p.id }],
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
  const full = readTables(app.tutorJobs.db);
  for (const table of ['topics', 'score_decisions', 'review_targets', 'attempts'])
    expect(full[table]).toEqual(before[table]);
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

it('attributes recap and activity by study date and only counts assigned scheduled reviews', async () => {
  const p = await problem();
  const first = await finish(await start(p.id, 'review'));
  const db = app.tutorJobs.db;
  db.prepare("UPDATE attempts SET studyDate = '2026-09-14' WHERE id = ?").run(first.id);
  const saved = one<Record<string, unknown>>(db, 'SELECT * FROM attempts WHERE id = ?', first.id);
  for (let i = 0; i < 25; i++)
    insert(db, 'attempts', { ...saved, id: `previous-week-${i}`, studyDate: '2026-09-13' });
  insert(db, 'daily_plans', {
    id: 'plan',
    date: '2026-09-14',
    timezone: 'Australia/Sydney',
    version: 1,
  });
  insert(db, 'plan_items', {
    id: 'item',
    planId: 'plan',
    position: 0,
    problemId: p.id,
    status: 'completed',
    reason: 'Scheduled review',
  });
  insert(db, 'attempts', { ...saved, id: 'scheduled', planItemId: 'item', help: 'small' });
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

it('gives every tag a notebook whether it is a topic or a pattern', async () => {
  const p = await problem();
  const broad = (
    await request('POST', '/api/tags', { name: 'Binary Search', kind: 'topic' })
  ).json();
  const technique = (
    await request('POST', '/api/tags', { name: 'Binary Search on Answer Space' })
  ).json();
  await request('PATCH', `/api/problems/${p.id}`, {
    tags: [{ tagId: broad.id }, { tagId: technique.id }],
  });
  await request('PATCH', `/api/patterns/${broad.id}`, {
    version: 1,
    recognitionCues: 'Retained cue',
    pitfalls: '',
    notes: 'Saved before correction',
  });
  expect((await request('GET', '/api/patterns')).json()).toMatchObject([
    { id: broad.id },
    { id: technique.id },
  ]);
  expect((await request('GET', `/api/patterns/${broad.id}`)).json()).toMatchObject({
    notes: 'Saved before correction',
    examples: [{ id: p.id }],
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
  // A topic tag counts as the problem's topic; a pattern tag does not.
  expect((await request('GET', '/api/problems?leetcodeTopic=Binary%20Search')).json().total).toBe(
    1,
  );
  expect((await request('GET', '/api/problems?leetcodeTopic=Answer%20Space')).json().total).toBe(0);
  await request('PATCH', `/api/tags/${broad.id}`, { kind: 'pattern' });
  expect((await request('GET', `/api/patterns/${broad.id}`)).json()).toMatchObject({
    notes: 'Saved before correction',
    examples: [{ id: p.id }],
  });
});
