import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
async function fixture(dbPath = ':memory:', clock = () => new Date('2026-09-16T01:00:00Z')) {
  const app = await createApp({ dbPath, token: 'test', clock });
  apps.push(app);
  const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  await request('POST', '/api/import', {
    importId: 'fixture',
    dryRun: false,
    source: { retrievedAt: '2026-09-16T00:00:00Z' },
    problems: [
      {
        key: 'two-sum',
        title: 'Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
        tags: ['Arrays & Hashing'],
        lists: ['NeetCode 250'],
        legacyCompleted: true,
      },
      {
        key: 'contains-duplicate',
        title: 'Contains Duplicate',
        url: 'https://leetcode.com/problems/contains-duplicate/',
        tags: ['Arrays & Hashing'],
        lists: ['NeetCode 250'],
      },
      {
        key: 'valid-palindrome',
        title: 'Valid Palindrome',
        url: 'https://leetcode.com/problems/valid-palindrome/',
        tags: ['Two Pointers'],
        lists: ['NeetCode 250'],
      },
      {
        key: 'outside',
        title: 'Outside',
        url: 'https://leetcode.com/problems/outside/',
        tags: ['Arrays & Hashing'],
        lists: ['Other'],
        legacyCompleted: true,
      },
    ],
    attempts: [],
    topics: [
      { name: 'Arrays & Hashing', score: 3.5, notes: 'Historical evidence', provisional: true },
    ],
    movements: [
      {
        sourceKey: 'score-1',
        topicName: 'Arrays & Hashing',
        date: '2026-08-01',
        oldScore: 3.4,
        newScore: 3.5,
        rationale: 'Saved decision',
        evidence: 'legacy',
      },
    ],
    planned: [],
    records: [],
  });
  const list = (await request('GET', '/api/lists'))
    .json()
    .find((l: { name: string }) => l.name === 'NeetCode 250');
  const config = {
    listId: list.id,
    strategy: 'topic',
    startTopic: null,
    completed: 'exclude',
    refresherSlots: 1,
  };
  return { app, request, config };
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
it('persists explicit recommendation settings while rejecting invalid values', async () => {
  const app = await createApp({ dbPath: ':memory:', token: 'test' });
  apps.push(app);
  const headers = { authorization: 'Bearer test' };
  const list = (
    await app.inject({ method: 'POST', url: '/api/lists', headers, payload: { name: 'Focus' } })
  ).json();
  const recommendations = {
    listId: list.id,
    strategy: 'topic',
    startTopic: null,
    completed: 'refreshers',
    refresherSlots: 1,
  };
  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { recommendations },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().recommendations).toEqual(recommendations);
  for (const bad of [
    { ...recommendations, listId: 'missing' },
    { ...recommendations, startTopic: 'Missing topic' },
    { ...recommendations, refresherSlots: 21 },
    { ...recommendations, strategy: 'bad' },
  ])
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/settings',
          headers,
          payload: { recommendations: bad },
        })
      ).statusCode,
    ).toBe(400);
});
it('uses a hard list boundary, counts completions and progresses in verified topic order', async () => {
  const { request, config } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 3, recommendations: config });
  const options = (await request('GET', '/api/recommendations/options')).json();
  expect(options.topics[0]).toMatchObject({ name: 'Arrays & Hashing', completed: 1, total: 2 });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(plan.items.map((i: { title: string }) => i.title)).toEqual(['Contains Duplicate']);
  expect(
    (await request('POST', `/api/plan-items/${plan.items[0].id}/disposition`, { action: 'swap' }))
      .statusCode,
  ).toBe(409);
  const attempt = (
    await request('POST', '/api/attempts', {
      problemId: plan.items[0].problemId,
      planItemId: plan.items[0].id,
      context: 'targeted',
    })
  ).json();
  expect(
    (
      await request('POST', `/api/attempts/${attempt.id}/finish`, {
        version: attempt.version,
        outcome: 'solved',
        help: 'none',
        activeSeconds: 10,
      })
    ).statusCode,
  ).toBe(200);
  expect((await request('GET', '/api/recommendations/options')).json().currentTopic).toBe(
    'Two Pointers',
  );
  await request('PATCH', '/api/settings', {
    recommendations: { ...config, completed: 'refreshers' },
  });
  const next = (await request('POST', '/api/daily-plan/ensure', { date: '2026-09-17' })).json();
  expect(next.items.map((i: { title: string }) => i.title)).toContain('Valid Palindrome');
  expect(next.items.filter((i: { title: string }) => i.title !== 'Valid Palindrome')).toHaveLength(
    1,
  );
  expect(next.items.every((i: { title: string }) => i.title !== 'Outside')).toBe(true);
  const fresh = next.items.find((i: { title: string }) => i.title === 'Valid Palindrome');
  expect(
    (await request('POST', `/api/plan-items/${fresh.id}/disposition`, { action: 'swap' }))
      .statusCode,
  ).toBe(409); // retained refresher already uses the allowance
});
it('rebuilds only unstarted items with a version guard and preserves all saved work and manual reviews', async () => {
  const { request, config } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 4 });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  const outside = plan.items.find((i: { title: string }) => i.title === 'Outside');
  const done = (
    await request('POST', '/api/attempts', {
      problemId: outside.problemId,
      planItemId: outside.id,
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
  const activeItem = plan.items.find((i: { title: string }) => i.title === 'Two Sum');
  const a = (
    await request('POST', '/api/attempts', {
      problemId: activeItem.problemId,
      planItemId: activeItem.id,
      context: 'targeted',
    })
  ).json();
  await request('PATCH', `/api/attempts/${a.id}/draft`, {
    version: a.version,
    code: 'saved draft',
    notes: 'keep this',
  });
  await request('PATCH', '/api/settings', { recommendations: config });
  const before = (await request('GET', '/api/export')).json().tables;
  const current = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(current.items).toHaveLength(4);
  expect(
    (await request('POST', `/api/daily-plans/${plan.id}/rebuild`, { version: plan.version }))
      .statusCode,
  ).toBe(409);
  const rebuilt = await request('POST', `/api/daily-plans/${plan.id}/rebuild`, {
    version: current.version,
  });
  expect(rebuilt.statusCode).toBe(200);
  expect(
    rebuilt
      .json()
      .items.map((i: { title: string }) => i.title)
      .sort(),
  ).toEqual(['Contains Duplicate', 'Outside', 'Two Sum']);
  for (const id of [outside.id, activeItem.id])
    expect(rebuilt.json().items.find((i: { id: string }) => i.id === id)).toEqual(
      current.items.find((i: { id: string }) => i.id === id),
    );
  const after = (await request('GET', '/api/export')).json().tables;
  for (const table of Object.keys(before).filter((t) => !['daily_plans', 'plan_items'].includes(t)))
    expect(after[table]).toEqual(before[table]);
});
it('resumes after restart and across days using completion evidence, not yesterday’s queue or later retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-recommendations-'));
  let now = new Date('2026-09-16T01:00:00Z');
  const fixed = await fixture(join(dir, 'test.sqlite'), () => now);
  let app = fixed.app;
  apps.splice(apps.indexOf(app), 1); // this test closes and reopens it itself
  const config = { ...fixed.config, startTopic: 'Arrays & Hashing' };
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  try {
    await call('POST', '/api/problems', {
      title: 'Valid Anagram',
      url: 'https://leetcode.com/problems/valid-anagram/',
      listIds: [config.listId],
    });
    await call('PATCH', '/api/settings', { questionsPerDay: 1, recommendations: config });
    const first = (await call('POST', '/api/daily-plan/ensure', {})).json();
    now = new Date('2026-09-17T01:00:00Z');
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
    expect((await call('GET', '/api/settings')).json().recommendations).toEqual(config);
    expect((await call('POST', '/api/daily-plan/ensure', {})).json().id).toBe(second.id);
    const saved = (await call('GET', `/api/attempts/${attempt.id}`)).json();
    expect(saved.code).toBe('durable answer');
    expect(
      (
        await call('POST', `/api/attempts/${attempt.id}/finish`, {
          version: saved.version,
          outcome: 'solved',
          help: 'none',
          activeSeconds: 10,
        })
      ).statusCode,
    ).toBe(200);
    const third = (await call('POST', '/api/daily-plan/ensure', {})).json();
    expect(third.items[0].title).toBe('Valid Anagram'); // same topic, next remaining question
    const retry = (
      await call('POST', '/api/attempts', {
        problemId: second.items[0].problemId,
        context: 'targeted',
      })
    ).json();
    await call('POST', `/api/attempts/${retry.id}/finish`, {
      version: retry.version,
      outcome: 'not_solved',
      help: 'none',
      activeSeconds: 10,
    });
    expect((await call('GET', '/api/recommendations/options')).json().topics[0]).toMatchObject({
      completed: 2,
      total: 3,
    });
    expect((await call('POST', '/api/daily-plan/ensure', {})).json()).toEqual(third);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('keeps due reviews, refreshers, swaps and empty pools inside the selected list', async () => {
  const { request, config } = await fixture();
  const outside = (await request('GET', '/api/problems?search=Outside')).json().items[0];
  const attempt = (
    await request('POST', '/api/attempts', { problemId: outside.id, context: 'targeted' })
  ).json();
  expect(
    (
      await request('POST', `/api/attempts/${attempt.id}/finish`, {
        version: attempt.version,
        outcome: 'not_solved',
        help: 'none',
        activeSeconds: 10,
        reviewAction: 'manual',
        reviewDate: '2026-09-16',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await request('GET', '/api/reviews'))
      .json()
      .find((r: { problemId: string }) => r.problemId === outside.id).effectiveDate,
  ).toBe('2026-09-16');
  await request('PATCH', '/api/settings', {
    questionsPerDay: 1,
    recommendations: {
      ...config,
      strategy: 'balanced',
      completed: 'refreshers',
      refresherSlots: 0,
    },
  });
  const first = (await request('POST', '/api/daily-plan/ensure', {})).json();
  const swapped = (
    await request('POST', `/api/plan-items/${first.items[0].id}/disposition`, { action: 'swap' })
  ).json();
  expect(swapped.items.every((i: { title: string }) => i.title !== 'Outside')).toBe(true);
  expect(swapped.items.filter((i: { status: string }) => i.status !== 'skipped')).toHaveLength(1);
  await request('PATCH', '/api/settings', {
    questionsPerDay: 20,
    recommendations: { ...config, strategy: 'balanced', completed: 'legacy' },
  });
  const unrestrictedReviews = (
    await request('POST', '/api/daily-plan/ensure', { date: '2026-10-01' })
  ).json();
  expect(unrestrictedReviews.items).toHaveLength(3);
  expect(unrestrictedReviews.items.every((i: { title: string }) => i.title !== 'Outside')).toBe(
    true,
  );
  const empty = (await request('POST', '/api/lists', { name: 'Empty' })).json();
  await request('PATCH', '/api/settings', { recommendations: { ...config, listId: empty.id } });
  const rebuilt = (
    await request('POST', `/api/daily-plans/${first.id}/rebuild`, { version: swapped.version })
  ).json();
  expect(rebuilt.items.every((i: { status: string }) => i.status === 'skipped')).toBe(true);
  expect(
    (await request('POST', '/api/daily-plan/ensure', { date: '2026-09-17' })).json().items,
  ).toEqual([]);
});
it('records known-topic recommendations as targeted evidence even after settings change', async () => {
  const { request, config } = await fixture();
  await request('PATCH', '/api/settings', { recommendations: config });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  await request('PATCH', '/api/settings', { recommendations: { ...config, strategy: 'balanced' } });
  const item = plan.items[0];
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
it('does not spend refresher allowance on a newly completed curriculum item during rebuild', async () => {
  const { request, config } = await fixture();
  await request('PATCH', '/api/settings', { questionsPerDay: 2, recommendations: config });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json(),
    item = plan.items[0];
  const a = (
    await request('POST', '/api/attempts', {
      problemId: item.problemId,
      planItemId: item.id,
      context: 'targeted',
    })
  ).json();
  expect(
    (
      await request('POST', `/api/attempts/${a.id}/finish`, {
        version: a.version,
        outcome: 'solved',
        help: 'none',
        activeSeconds: 10,
      })
    ).statusCode,
  ).toBe(200);
  await request('PATCH', '/api/settings', {
    recommendations: { ...config, completed: 'refreshers' },
  });
  const current = (await request('GET', '/api/dashboard')).json().plan;
  const rebuilt = (
    await request('POST', `/api/daily-plans/${plan.id}/rebuild`, { version: current.version })
  ).json();
  expect(rebuilt.items.find((i: { status: string }) => i.status === 'active').title).toBe(
    'Two Sum',
  );
});
it('waits in an unfinished topic when its remaining question is scheduled later or set to no review', async () => {
  const { request, config } = await fixture();
  const p = (await request('GET', '/api/problems?search=Contains Duplicate')).json().items[0];
  const a = (
    await request('POST', '/api/attempts', { problemId: p.id, context: 'targeted' })
  ).json();
  expect(
    (
      await request('POST', `/api/attempts/${a.id}/finish`, {
        version: a.version,
        outcome: 'not_solved',
        help: 'none',
        activeSeconds: 10,
        reviewAction: 'manual',
        reviewDate: '2026-09-20',
      })
    ).statusCode,
  ).toBe(200);
  await request('PATCH', '/api/settings', { recommendations: config });
  const review = (await request('GET', '/api/reviews')).json()[0];
  expect((await request('POST', '/api/daily-plan/ensure', {})).json().items).toEqual([]);
  expect((await request('GET', '/api/recommendations/options')).json().currentTopic).toBe(
    'Arrays & Hashing',
  );
  expect(
    (await request('POST', '/api/daily-plan/ensure', { date: '2026-09-20' }))
      .json()
      .items.map((i: { title: string }) => i.title),
  ).toEqual(['Contains Duplicate']);
  expect(
    (
      await request('PATCH', `/api/reviews/${review.id}`, {
        version: review.version,
        action: 'none',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await request('POST', '/api/daily-plan/ensure', { date: '2026-09-21' })).json().items,
  ).toEqual([]);
  expect((await request('GET', '/api/recommendations/options')).json().topics[0].completed).toBe(1);
});

it('prioritizes unfinished topic questions when completed questions are included without a limit', async () => {
  const { request, config } = await fixture();
  await request('PATCH', '/api/settings', {
    questionsPerDay: 1,
    recommendations: { ...config, completed: 'legacy' },
  });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(plan.items.map((item: { title: string }) => item.title)).toEqual(['Contains Duplicate']);
});
