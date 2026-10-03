import { afterEach, expect, it } from 'vitest';
import { readTables } from '../tables.js';
import { createApp } from '../../src/server/core/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The built-in plan (tutor off): due checks, then the weakest topics. Never a list.
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
type Item = {
  id: string;
  problemId: string;
  title: string;
  status: string;
  reason: string;
  reviewOf: string | null;
  recommendationKind?: string;
};
async function fixture(dbPath = ':memory:', start = '2026-09-16T01:00:00Z') {
  let now = new Date(start);
  const app = await createApp({ dbPath, token: 'test', clock: () => now });
  apps.push(app);
  const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  await request('PATCH', '/api/settings', { timezone: 'UTC' });
  const problem = (slug: string, difficulty: string | null, topic?: string, extra = {}) => ({
    key: slug,
    title: slug,
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty,
    ...(topic ? { tags: [topic] } : {}),
    ...extra,
  });
  // Imported like the problem bank: tagged, rated and unseen.
  await request('POST', '/api/import', {
    importId: 'fixture',
    dryRun: false,
    source: { retrievedAt: '2026-09-16T00:00:00Z' },
    problems: [
      problem('ah-a', 'Easy', 'Arrays & Hashing'),
      problem('ah-b', 'Easy', 'Arrays & Hashing'),
      problem('ah-c', 'Easy', 'Arrays & Hashing'),
      problem('tp-a', 'Easy', 'Two Pointers'),
      problem('tp-b', 'Easy', 'Two Pointers'),
      problem('tp-c', 'Easy', 'Two Pointers'),
      // Above the 1,850 target (Hard ≈ 2,262), completed elsewhere, or without a topic.
      problem('graph-hard', 'Hard', 'Graphs'),
      problem('done-before', 'Easy', 'Arrays & Hashing', { legacyCompleted: true }),
      problem('untagged', 'Easy'),
    ],
    attempts: [],
    topics: [],
    movements: [],
    records: [],
  });
  // Read IDs directly: listing problems with their tags would mark them as seen.
  const ids = new Map<string, string>(
    (
      app.tutorJobs.db.prepare('SELECT id, slug FROM problems').all() as {
        id: string;
        slug: string;
      }[]
    ).map((p) => [p.slug, p.id]),
  );
  const ensure = async (date?: string) =>
    (await request('POST', '/api/daily-plan/ensure', date ? { date } : {})).json() as {
      id: string;
      version: number;
      date: string;
      items: Item[];
    };
  /** Start (from Today, or directly) and finish an attempt. */
  const practise = async (problemId: string, result: object, planItemId?: string) => {
    const a = (
      await request('POST', '/api/attempts', {
        problemId,
        context: planItemId ? 'mixed' : 'targeted',
        ...(planItemId ? { planItemId } : {}),
      })
    ).json();
    const done = await request('POST', `/api/attempts/${a.id}/finish`, {
      version: a.version,
      ...result,
    });
    expect(done.statusCode).toBe(200);
    return a as { id: string; evidence: string };
  };
  const target = async (problemId: string) =>
    (await request('GET', '/api/reviews'))
      .json()
      .find((r: { problemId: string }) => r.problemId === problemId) as {
      stage: string;
      action: string;
      effectiveDate: string | null;
    };
  return {
    app,
    request,
    ids,
    ensure,
    practise,
    target,
    at: (iso: string) => {
      now = new Date(iso);
    },
  };
}
const titles = (items: { title: string }[]) => items.map((i) => i.title);
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

it('persists the target rating and ignores retired list settings', async () => {
  const { request } = await fixture();
  const saved = await request('PATCH', '/api/settings', {
    recommendations: { targetRating: 1800 },
  });
  expect(saved.json().recommendations).toEqual({ targetRating: 1800 });
  for (const bad of [
    { targetRating: 900 },
    { targetRating: 3000 },
    { listId: null, strategy: 'topic', startTopic: null, completed: 'exclude', refresherSlots: 1 },
  ])
    expect((await request('PATCH', '/api/settings', { recommendations: bad })).statusCode).toBe(
      400,
    );
});

it('plans the weakest topics first, one problem each, never above target or already done', async () => {
  const { request, ensure } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 3 });
  const plan = await ensure();
  // Equal levels go fundamentals first; one per topic, then round again.
  expect(titles(plan.items)).toEqual(['ah-a', 'tp-a', 'ah-b']);
  expect(plan.items[0]).toMatchObject({
    reason: 'Arrays & Hashing · your level 1300',
    recommendationKind: 'topic',
    reviewOf: null,
  });
  expect(plan.items[0]).toHaveProperty('rating', { value: 1252, estimated: true });
  await request('PATCH', '/api/settings', { questionsPerDay: 20 });
  const all = titles((await ensure('2026-09-17')).items);
  for (const never of ['graph-hard', 'done-before', 'untagged']) expect(all).not.toContain(never);
});

it('brings an idea back as a different problem: a repair after a struggle, practice later, then retires it', async () => {
  const { request, ids, ensure, practise, target, at } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 3 });
  // Day 1: a struggle in Arrays & Hashing, a hinted solve in Two Pointers.
  await practise(ids.get('ah-a')!, { outcome: 'not_solved', help: 'major', activeSeconds: 900 });
  await practise(ids.get('tp-a')!, { outcome: 'solved', help: 'small', activeSeconds: 600 });
  expect(await target(ids.get('ah-a')!)).toMatchObject({
    stage: 'repair',
    effectiveDate: '2026-09-17',
  });

  // Day 2: the struggle comes back as easier practice from the same topic, not the problem.
  at('2026-09-17T01:00:00Z');
  const day2 = await ensure();
  expect(day2.items[0]).toMatchObject({
    title: 'ah-b',
    reviewOf: ids.get('ah-a'),
    reason: 'Arrays & Hashing · easier practice after ah-a',
  });
  expect(titles(day2.items)).not.toContain('ah-a');
  expect(titles(day2.items)).not.toContain('tp-a');
  await practise(
    day2.items[0]!.problemId,
    { outcome: 'solved', help: 'none', activeSeconds: 300, confidence: 5 },
    day2.items[0]!.id,
  );
  // The repair moved the original idea on; the easier problem has no schedule of its own.
  expect((await target(ids.get('ah-a')!)).stage).toBe('mixed');
  expect((await target(ids.get('ah-b')!)).action).toBe('none');

  // Day 4: the hinted solve's idea comes back as a different problem from its topic.
  // (Hidden same-idea transfer checks need Bloom; the rules label this as topic practice.)
  at('2026-09-19T01:00:00Z');
  const day4 = await ensure();
  const check = day4.items.find((i) => i.reviewOf === ids.get('tp-a'))!;
  expect(check).toMatchObject({
    reason: 'Two Pointers · practice after tp-a',
    recommendationKind: 'topic',
  });
  expect(['tp-b', 'tp-c']).toContain(check.title);
  const practised = await practise(
    check.problemId,
    { outcome: 'solved', help: 'none', activeSeconds: 300, confidence: 5 },
    check.id,
  );
  expect(practised.evidence).toBe('near_transfer');
  expect(await target(ids.get('tp-a')!)).toMatchObject({
    stage: 'mixed',
    effectiveDate: '2026-10-03',
  });

  // Two weeks later another solo solve of the same idea retires it.
  at('2026-10-03T01:00:00Z');
  const later = await ensure();
  const second = later.items.find((i) => i.reviewOf === ids.get('tp-a'))!;
  expect(second.problemId).not.toBe(check.problemId);
  await practise(
    second.problemId,
    { outcome: 'solved', help: 'none', activeSeconds: 300, confidence: 5 },
    second.id,
  );
  expect(await target(ids.get('tp-a')!)).toMatchObject({ stage: 'retired', action: 'none' });
});

it('a confirmed plan change that keeps a repair or check keeps what it was checking', async () => {
  const { request, ids, ensure, practise, at } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 3 });
  await practise(ids.get('ah-a')!, { outcome: 'not_solved', help: 'major', activeSeconds: 900 });
  at('2026-09-17T01:00:00Z');
  const repair = (await ensure()).items.find((i) => i.reviewOf === ids.get('ah-a'))!;
  const changed = (
    await request('POST', '/api/daily-plan/changes', {
      change: {
        mode: 'replace',
        items: [
          { problemId: ids.get('ah-c'), title: 'ah-c', reason: 'Another step' },
          { problemId: repair.problemId, title: repair.title, reason: 'Keep this one' },
        ],
      },
      sourceConversation: 'chat',
    })
  ).json();
  const kept = changed.plan.items.find((i: Item) => i.problemId === repair.problemId);
  expect(kept).toMatchObject({ reviewOf: ids.get('ah-a'), reason: 'Keep this one' });
  expect(changed.plan.items.find((i: Item) => i.title === 'ah-c').reviewOf).toBeNull();
});

it('rebuilds only unstarted items with a version guard and preserves all saved work', async () => {
  const { app, request, ensure } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 4 });
  const plan = await ensure();
  const [doneItem, activeItem] = plan.items;
  const done = (
    await request('POST', '/api/attempts', {
      problemId: doneItem!.problemId,
      planItemId: doneItem!.id,
      context: 'targeted',
    })
  ).json();
  await request('POST', `/api/attempts/${done.id}/finish`, {
    version: done.version,
    outcome: 'solved',
    help: 'none',
    activeSeconds: 30,
    reviewAction: 'manual',
    reviewDate: '2026-12-01',
  });
  const a = (
    await request('POST', '/api/attempts', {
      problemId: activeItem!.problemId,
      planItemId: activeItem!.id,
      context: 'targeted',
    })
  ).json();
  await request('PATCH', `/api/attempts/${a.id}/draft`, {
    version: a.version,
    code: 'saved draft',
    notes: 'keep this',
  });
  const before = readTables(app.tutorJobs.db);
  const current = await ensure();
  expect(
    (await request('POST', `/api/daily-plans/${plan.id}/rebuild`, { version: plan.version }))
      .statusCode,
  ).toBe(409);
  const rebuilt = await request('POST', `/api/daily-plans/${plan.id}/rebuild`, {
    version: current.version,
  });
  expect(rebuilt.statusCode).toBe(200);
  for (const id of [doneItem!.id, activeItem!.id])
    expect(rebuilt.json().items.find((i: { id: string }) => i.id === id)).toEqual(
      current.items.find((i) => i.id === id),
    );
  expect(new Set(titles(rebuilt.json().items)).size).toBe(rebuilt.json().items.length);
  const after = readTables(app.tutorJobs.db);
  for (const table of Object.keys(before).filter((t) => !['daily_plans', 'plan_items'].includes(t)))
    expect(after[table]).toEqual(before[table]);
});

it('resumes after restart and across days without repeating finished work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-recommendations-'));
  const fixed = await fixture(join(dir, 'test.sqlite'));
  let app = fixed.app;
  apps.splice(apps.indexOf(app), 1); // this test closes and reopens it itself
  let now = new Date('2026-09-16T01:00:00Z');
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  try {
    await call('PATCH', '/api/settings', {
      questionsPerDay: 1,
      recommendations: { targetRating: 1800 },
    });
    const first = (await call('POST', '/api/daily-plan/ensure', {})).json();
    fixed.at('2026-09-17T01:00:00Z');
    const second = (await call('POST', '/api/daily-plan/ensure', {})).json();
    expect(second.items[0].problemId).toBe(first.items[0].problemId); // unstarted remains eligible
    const attempt = (
      await call('POST', '/api/attempts', {
        problemId: second.items[0].problemId,
        planItemId: second.items[0].id,
        context: 'targeted',
      })
    ).json();
    await call('PATCH', `/api/attempts/${attempt.id}/draft`, {
      version: attempt.version,
      code: 'durable answer',
    });
    await app.close();
    now = new Date('2026-09-18T01:00:00Z');
    app = await createApp({ dbPath: join(dir, 'test.sqlite'), token: 'test', clock: () => now });
    expect((await call('GET', '/api/settings')).json().recommendations).toEqual({
      targetRating: 1800,
    });
    expect((await call('POST', '/api/daily-plan/ensure', {})).json().id).toBe(second.id);
    const saved = (await call('GET', `/api/attempts/${attempt.id}`)).json();
    expect(saved.code).toBe('durable answer');
    await call('POST', `/api/attempts/${attempt.id}/finish`, {
      version: saved.version,
      outcome: 'solved',
      help: 'none',
      activeSeconds: 10,
    });
    const third = (await call('POST', '/api/daily-plan/ensure', { date: '2026-09-19' })).json();
    expect(third.items[0].problemId).not.toBe(attempt.problemId); // never repeated
    expect((await call('POST', '/api/daily-plan/ensure', { date: '2026-09-19' })).json()).toEqual(
      third,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('lets a snoozed new problem wait, swaps within the candidates and handles an empty library', async () => {
  const { request, ensure } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 2 });
  const today = await ensure();
  const snoozed = today.items[1]!;
  await request('POST', `/api/plan-items/${snoozed.id}/disposition`, {
    action: 'snooze',
    until: '2026-09-20',
  });
  expect(titles((await ensure('2026-09-18')).items)).not.toContain(snoozed.title);
  // Once its date comes, a never-attempted problem is simply new again (not a check).
  const back = (await ensure('2026-09-21')).items;
  expect(back.every((i) => i.reviewOf === null)).toBe(true);

  const swapped = (
    await request('POST', `/api/plan-items/${today.items[0]!.id}/disposition`, { action: 'swap' })
  ).json();
  // Both of the day's items are now set aside (one snoozed, one swapped): one replacement.
  const live = swapped.items.filter((i: { status: string }) => i.status !== 'skipped');
  expect(live).toHaveLength(1);
  expect(titles(live)).not.toContain('graph-hard');
  expect(titles(live)).not.toContain(snoozed.title);

  const empty = await createApp({ dbPath: ':memory:', token: 'test' });
  apps.push(empty);
  const plan = await empty.inject({
    method: 'POST',
    url: '/api/daily-plan/ensure',
    headers: { authorization: 'Bearer test' },
    payload: {},
  });
  expect(plan.json().items).toEqual([]);
});

it('records topic picks as known-topic (targeted) evidence', async () => {
  const { request, ensure } = await fixture();
  const plan = await ensure();
  const item = plan.items[0]!;
  const started = (
    await request('POST', '/api/attempts', {
      problemId: item.problemId,
      planItemId: item.id,
      context: 'mixed',
    })
  ).json();
  expect(started.evidence).toBe('near_transfer');
  expect((await request('GET', `/api/attempts/${started.id}/context`)).statusCode).toBe(200);
});
