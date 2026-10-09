import { afterEach, beforeEach, expect, test } from 'vitest';
import type { GenerateRequest } from '../../src/server/tutor/generate.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { callTool } from '../../src/integrations/mcp.js';
import type { LocalApi } from '../../src/integrations/local-api.js';

let app: Awaited<ReturnType<typeof createApp>>, dir: string, scoped: string;
const request = (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  token = 'host',
  key = 'k1',
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
// The adapter as the tutor runs it: scoped credential, real routes.
const tutorApi = {
  request: async (method: 'GET' | 'POST', url: string) =>
    (await request(method, url.replace(/^\/?/, '/'), undefined, scoped)).json(),
} as unknown as LocalApi;
const tool = async (name: string, args: unknown) =>
  JSON.parse((await callTool(tutorApi, name, args)).content[0]!.text);

const easy = ['Search One', 'Search Two', 'Search Three', 'Search Four'];
const slug = (title: string) => title.toLowerCase().replaceAll(' ', '-');
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-plan-'));
  app = await createApp({
    dbPath: join(dir, 'study.sqlite'),
    token: 'host',
    clock: () => new Date('2026-10-01T09:00:00Z'),
  });
  scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
  // A fresh learner's Binary Search window is 1,150–1,350: Easy (≈1,252) fits, Hard doesn't.
  const tag = (await request('POST', '/api/tags', { name: 'Binary Search' })).json();
  for (const [title, difficulty] of [...easy.map((t) => [t, 'Easy']), ['Search Hard', 'Hard']])
    expect(
      (
        await request('POST', '/api/problems', {
          title,
          url: `https://leetcode.com/problems/${slug(title)}/`,
          difficulty,
          tags: [{ tagId: tag.id }],
        })
      ).statusCode,
    ).toBe(200);
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
const titles = (items: { title: string }[]) => items.map((i) => i.title);

test('tutor proposes only shortlisted library problems and cannot add them itself', async () => {
  const unmatched = await tool('propose_plan_change', {
    items: [{ title: 'Search On', reason: 'Bounds' }],
  });
  expect(unmatched.proposal).toBeUndefined();
  expect(unmatched.unmatched[0].closest).toContain('Search One');
  // Above the learner's window: the app refuses it, whatever the model wants.
  const hard = await tool('propose_plan_change', {
    items: [{ title: 'Search Hard', reason: 'Stretch' }],
  });
  expect(hard).toMatchObject({ saved: false, notOnShortlist: ['Search Hard'] });

  const shortlist = await tool('get_shortlist', {});
  const offered = titles(shortlist.topics.flatMap((t: { problems: [] }) => t.problems));
  expect(offered).not.toContain('Search Hard');
  const { proposal } = await tool('propose_plan_change', {
    items: [{ title: 'search one', reason: 'Bounds' }],
  });
  expect(titles(proposal.items)).toEqual(['Search One']);
  const body = { change: proposal, sourceConversation: 'conversation-1' };
  expect((await request('POST', '/api/daily-plan/changes', body, scoped)).statusCode).toBe(403);
});

test('confirmed additions join today’s plan once and retries are safe', async () => {
  const today = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(today.items).toHaveLength(2);
  expect(titles(today.items)).not.toContain('Search Hard');
  const extra = easy.find((t) => !titles(today.items).includes(t))!;
  const { proposal } = await tool('propose_plan_change', {
    items: [{ title: extra, reason: 'Binary search on the answer' }],
  });
  const body = { change: proposal, sourceConversation: 'conversation-1' };
  const first = (await request('POST', '/api/daily-plan/changes', body)).json();
  expect(first.added).toEqual([extra]);
  expect(first.plan.id).toBe(today.id);
  expect(first.plan.items.at(-1)).toMatchObject({
    title: extra,
    status: 'queued',
    reason: 'Binary search on the answer',
  });

  expect((await request('POST', '/api/daily-plan/changes', body)).json()).toEqual(first);
  const again = (await request('POST', '/api/daily-plan/changes', body, 'host', 'k2')).json();
  expect(again.added).toEqual([]);
  expect(
    await tool('propose_plan_change', {
      items: [{ title: today.items[0].title, reason: 'Already planned' }],
    }),
  ).toMatchObject({ alreadyOnPlan: [today.items[0].title] });
  expect(
    (
      await request(
        'POST',
        '/api/daily-plan/changes',
        {
          ...body,
          change: { ...proposal, items: [{ ...proposal.items[0], title: 'Something else' }] },
        },
        'host',
        'k3',
      )
    ).statusCode,
  ).toBe(409);
});

test('replacing keeps started work and swaps only unstarted items', async () => {
  const today = (await request('POST', '/api/daily-plan/ensure', {})).json();
  const [first, second] = today.items;
  const attempt = (
    await request('POST', '/api/attempts', {
      problemId: first.problemId,
      planItemId: first.id,
      context: 'targeted',
      language: 'python',
    })
  ).json();
  // Bloom is blocked while practising; finish the attempt first.
  await request(
    'POST',
    `/api/attempts/${attempt.id}/finish`,
    { version: attempt.version, outcome: 'solved', help: 'none', activeSeconds: 600 },
    'host',
    'finish',
  );
  const fresh = easy.find((t) => !titles(today.items).includes(t))!;
  const { proposal } = await tool('propose_plan_change', {
    mode: 'replace',
    items: [
      { title: first.title, reason: 'Already done' },
      { title: fresh, reason: 'Next step' },
    ],
  });
  expect(titles(proposal.items)).toEqual([fresh]);
  const result = (
    await request('POST', '/api/daily-plan/changes', {
      change: proposal,
      sourceConversation: 'conversation-1',
    })
  ).json();
  expect(titles(result.plan.items).sort()).toEqual([first.title, fresh].sort());
  expect(result.removed).toEqual([second.title]);
  expect(result.plan.items.find((i: { title: string }) => i.title === first.title).status).toBe(
    'completed',
  );
});

/** Bloom planning as the worker runs it, with a scripted answer instead of Codex. */
async function bloomOn() {
  const drafts = app.tutorJobs.drafts as unknown as { isActive: () => boolean };
  drafts.isActive = () => true;
  const { draftPlanNext } = await import('../../src/server/tutor/plan-job.js');
  let seen: {
    picksRequired: number;
    candidates: { candidateNumber: number; title: string; topic: string }[];
    checks: { checkNumber: number; kind: string; problem: string }[];
    tutorNotes: { lesson: string; topic: string | null }[];
  };
  const run = (answer: (context: typeof seen) => object) =>
    draftPlanNext(app.tutorJobs.drafts, async (req: GenerateRequest) => {
      seen = req.context as typeof seen;
      return { model: null, text: JSON.stringify(answer(seen)) };
    });
  return { drafts, run };
}
const item = (
  candidateNumber: number | null,
  checkNumber: number | null,
  sameIdea: string[] = [],
) => ({
  candidateNumber,
  checkNumber,
  sameIdea,
  reason: candidateNumber ? 'Builds on your goal' : '',
});

/** An idea practised earlier and due today, plus unseen bank problems for its check. */
async function dueIdea() {
  const attempted = (await request('GET', `/api/problems?search=Search%20One`)).json().items[0];
  const a = (
    await request('POST', '/api/attempts', { problemId: attempted.id, context: 'targeted' })
  ).json();
  await request(
    'POST',
    `/api/attempts/${a.id}/finish`,
    {
      version: a.version,
      outcome: 'solved',
      help: 'small',
      activeSeconds: 600,
      reviewAction: 'manual',
      reviewDate: '2026-10-01',
    },
    'host',
    'finish-one',
  );
  await request('POST', '/api/import', {
    importId: 'bank',
    dryRun: false,
    source: { retrievedAt: '2026-10-01T00:00:00Z' },
    problems: ['Search Five', 'Search Six'].map((title) => ({
      key: slug(title),
      title,
      url: `https://leetcode.com/problems/${slug(title)}/`,
      difficulty: 'Easy',
      tags: ['Binary Search'],
    })),
    attempts: [],
    topics: [],
    movements: [],
    records: [],
  });
  return attempted as { id: string };
}

test('Bloom plans the day: the plan waits for it, then its picks and transfer checks become the plan', async () => {
  const attempted = await dueIdea();
  const { run } = await bloomOn();
  // Confirmed lessons reach the planner; forgotten ones do not.
  const lesson = (text: string, key: string) =>
    request(
      'POST',
      '/api/tutor-notes',
      { change: { action: 'create', text, topic: null }, sourceConversation: 'chat' },
      'host',
      key,
    ).then((r) => r.json() as { id: string });
  await lesson('Order picks easier first.', 'kept');
  const forgotten = await lesson('Only ever pick Hard problems.', 'forgotten');
  await request('POST', `/api/tutor-notes/${forgotten.id}/forget`, {});
  let lessons: unknown;
  const dueInChat = async () =>
    (await request('GET', '/api/recommendations/shortlist', undefined, scoped))
      .json()
      .checks.map((c: { title: string }) => c.title);
  expect(await dueInChat()).toContain('Search One');
  const waiting = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(waiting.items).toEqual([]);
  expect((await request('GET', '/api/plan-drafts/today')).json()).toMatchObject({
    plan: { status: 'pending' },
    tutorActive: true,
  });

  expect(
    await run((context) => {
      const check = context.checks.find((c) => c.problem === 'Search One')!;
      lessons = context.tutorNotes;
      return {
        summary: 'Binary search, steady and popular.',
        items: [
          // "Search Two" was seen in the library listing above, so the app skips it.
          item(null, check.checkNumber, ['Search Two', 'Search Five']),
          item(context.candidates.find((c) => c.title !== 'Search Five')!.candidateNumber, null),
        ],
      };
    }),
  ).toBe(true);
  expect(lessons).toEqual([{ lesson: 'Order picks easier first.', topic: null }]);
  const planned = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(planned.id).toBe(waiting.id);
  expect(planned.items).toHaveLength(2);
  expect(planned.items[0]).toMatchObject({
    title: 'Search Five',
    reviewOf: attempted.id,
    reason: 'Transfer check — spot the approach yourself',
  });
  expect(planned.items[1].reason).toBe('Builds on your goal');
  // Chat no longer offers the idea: it is on today's plan.
  expect(await dueInChat()).not.toContain('Search One');
  expect((await request('GET', '/api/plan-drafts/today')).json().plan).toMatchObject({
    status: 'applied',
    summary: 'Binary search, steady and popular.',
  });
  expect(await run(() => ({}))).toBe(false); // once per plan

  // A malformed answer fails the re-plan and keeps the plan.
  await request('POST', '/api/plan-drafts/today/refresh', {});
  await run(() => ({ summary: 'x', items: [] }));
  expect((await request('GET', '/api/plan-drafts/today')).json().plan.status).toBe('failed');
  expect((await request('POST', '/api/daily-plan/ensure', {})).json().items).toEqual(planned.items);
  // An unusable item is skipped, not fatal: the rules fill its place.
  await request('POST', '/api/plan-drafts/today/refresh', {});
  await run(() => ({ summary: 'Mostly fine.', items: [item(99, null)] }));
  expect((await request('GET', '/api/plan-drafts/today')).json().plan.status).toBe('applied');
  expect((await request('POST', '/api/daily-plan/ensure', {})).json().items).toHaveLength(2);
});

test('the built-in rules plan the day when Bloom is off, fails or is overtaken', async () => {
  // Off: the rules plan immediately.
  const off = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(off.items.length).toBeGreaterThan(0);
  expect((await request('GET', '/api/plan-drafts/today')).json().plan).toBeNull();
});

test('a plan Bloom could not make falls back to the rules, and a late answer never replaces them', async () => {
  const { drafts, run } = await bloomOn();
  expect((await request('POST', '/api/daily-plan/ensure', {})).json().items).toEqual([]);
  // Bloom fails: the rules fill the empty day at once.
  await draftFailure(run);
  expect((await request('GET', '/api/plan-drafts/today')).json().plan.status).toBe('failed');
  const ruled = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(ruled.items.length).toBeGreaterThan(0);

  // Re-plan, then the tutor goes off before Bloom answers: the rules' plan stands.
  await request('POST', '/api/plan-drafts/today/refresh', {});
  const { draftPlanNext } = await import('../../src/server/tutor/plan-job.js');
  const late = draftPlanNext(app.tutorJobs.drafts, async () => {
    drafts.isActive = () => false;
    await request('POST', `/api/daily-plans/${ruled.id}/rebuild`, { version: ruled.version });
    app.tutorJobs.drafts.supersede(ruled.id);
    return {
      model: null,
      text: JSON.stringify({ summary: 'Too late', items: [item(1, null)] }),
    };
  });
  await late;
  expect((await request('GET', '/api/plan-drafts/today')).json().plan.status).toBe('superseded');
  const kept = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(kept.items.some((i: { reason: string }) => i.reason === 'Builds on your goal')).toBe(
    false,
  );
});
test('without a fair same-idea problem from Bloom, the check is plain topic practice, never a hidden transfer check', async () => {
  const attempted = await dueIdea();
  const { run } = await bloomOn();
  await request('POST', '/api/daily-plan/ensure', {});
  await run((context) => {
    const check = context.checks.find((c) => c.problem === 'Search One')!;
    // Both named problems are unfair: one seen in the library, one not in the bank at all.
    return {
      summary: 'x',
      items: [item(null, check.checkNumber, ['Search Two', 'No Such Problem'])],
    };
  });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  const linked = plan.items.find((i: { reviewOf: string | null }) => i.reviewOf === attempted.id);
  expect(linked.reason).toBe('Binary Search · practice after Search One');
  expect(linked.recommendationKind).toBe('topic');
});

test('an idea is checked at most once a day, even when Bloom repeats a problem', async () => {
  await dueIdea();
  const { run } = await bloomOn();
  await request('POST', '/api/daily-plan/ensure', {});
  await run((context) => {
    const check = context.checks.find((c) => c.problem === 'Search One')!;
    const five = context.candidates.find((c) => c.title === 'Search Five')!;
    return {
      summary: 'Repeats itself.',
      items: [item(null, check.checkNumber, ['Search Five']), item(five.candidateNumber, null)],
    };
  });
  const plan = (await request('POST', '/api/daily-plan/ensure', {})).json();
  const problems = plan.items.map((i: { problemId: string }) => i.problemId);
  expect(new Set(problems).size).toBe(problems.length);
  expect(plan.items.filter((i: { reviewOf: string | null }) => i.reviewOf)).toHaveLength(1);
});
async function draftFailure(run: (answer: () => object) => Promise<boolean>) {
  await run(() => ({ summary: 'x', items: [] }));
}
