import { afterEach, beforeEach, expect, test } from 'vitest';
import type { GenerateRequest } from '../../src/server/tutor/generate.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { callTool } from '../../src/integrations/mcp.js';
import type { LocalApi } from '../../src/integrations/local-api.js';

let app: Awaited<ReturnType<typeof createApp>>, dir: string, scoped: string, now: Date;
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
  request: async (method: 'GET' | 'POST', url: string, body?: unknown) =>
    (await request(method, url.replace(/^\/?/, '/'), body, scoped)).json(),
} as unknown as LocalApi;
const tool = async (name: string, args: unknown) =>
  JSON.parse((await callTool(tutorApi, name, args)).content[0]!.text);

const easy = ['Search One', 'Search Two', 'Search Three', 'Search Four'];
const slug = (title: string) => title.toLowerCase().replaceAll(' ', '-');
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-plan-'));
  now = new Date('2026-10-01T09:00:00Z');
  app = await createApp({
    dbPath: join(dir, 'study.sqlite'),
    token: 'host',
    clock: () => now,
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

  // The learner named it: proposed as asked, flagged for the tutor to mention.
  const named = await tool('propose_plan_change', {
    items: [{ title: 'Search Hard', reason: 'You asked for it', requested: true }],
  });
  expect(titles(named.proposal.items)).toEqual(['Search Hard']);
  expect(named.outsideShortlist).toEqual([{ title: 'Search Hard', attempted: false }]);
  const applied = (
    await request('POST', '/api/daily-plan/changes', {
      change: named.proposal,
      sourceConversation: 'conversation-1',
    })
  ).json();
  expect(applied.added).toEqual(['Search Hard']);
});

test('chat proposes a due check as its served problem, linked to the idea it checks', async () => {
  const attempted = await dueIdea();
  const check = (await request('GET', '/api/recommendations/shortlist', undefined, scoped))
    .json()
    .checks.find((c: { title: string }) => c.title === 'Search One');
  expect(check.serveAs).toBeTruthy();
  expect(check.serveAs).not.toBe('Search One');
  // The original is a redo: refused unless the learner named it.
  expect(
    await tool('propose_plan_change', { items: [{ title: 'Search One', reason: 'Review' }] }),
  ).toMatchObject({ notOnShortlist: ['Search One'] });
  const { proposal } = await tool('propose_plan_change', {
    items: [{ title: check.serveAs, reason: 'Revisit the idea' }],
  });
  expect(proposal.items[0]).toMatchObject({ title: check.serveAs, reviewOf: attempted.id });
  const { plan } = (
    await request('POST', '/api/daily-plan/changes', {
      change: proposal,
      sourceConversation: 'conversation-1',
    })
  ).json();
  expect(plan.items.find((i: { title: string }) => i.title === check.serveAs).reviewOf).toBe(
    attempted.id,
  );
  // Served today, so it is no longer due in chat.
  const after = (await request('GET', '/api/recommendations/shortlist', undefined, scoped)).json();
  expect(after.checks.map((c: { title: string }) => c.title)).not.toContain('Search One');
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

async function finish(problemId: string, planItemId?: string) {
  const a = (
    await request('POST', '/api/attempts', { problemId, planItemId, context: 'targeted' })
  ).json();
  await request(
    'POST',
    `/api/attempts/${a.id}/finish`,
    { version: a.version, outcome: 'solved', help: 'none', activeSeconds: 600 },
    'host',
    `finish-${a.id}`,
  );
}
const planFrom = (planSource: 'bloom' | 'list') =>
  app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { authorization: 'Bearer host' },
    payload: { planSource },
  });
async function setList(slugs: string[]) {
  await planFrom('list');
  return (await request('POST', '/api/study-list', { entries: slugs })).json();
}

test('a study list fills the day first, repeats included, and the rules fill the rest', async () => {
  const one = (await request('GET', '/api/problems?search=Search%20One')).json().items[0];
  await finish(one.id); // solved before it was listed: still on the list
  now = new Date('2026-10-01T10:00:00Z');
  expect(await setList(['search-hard', 'search-one', 'not-in-library', 'search-two'])).toEqual({
    planSource: 'list',
    name: null,
    slugs: ['search-hard', 'search-one', 'not-in-library', 'search-two'],
    remaining: ['Search Hard', 'Search One', 'Search Two'],
    finished: [],
    notInLibrary: ['not-in-library'],
    unmatched: [],
  });
  const day1 = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(titles(day1.items)).toEqual(['Search Hard', 'Search One']);
  expect(day1.items[0]).toMatchObject({ status: 'active', reason: 'From your study list' });
  await finish(day1.items[0].problemId, day1.items[0].id);
  expect((await request('GET', '/api/study-list')).json().finished).toEqual(['Search Hard']);

  // The next day: unfinished problems carry over; a shorter list leaves room for the rules.
  now = new Date('2026-10-02T09:00:00Z');
  await setList(['search-two', 'search-hard']);
  const day2 = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(day2.items).toHaveLength(2);
  expect(day2.items[0]).toMatchObject({ title: 'Search Two', reason: 'From your study list' });
  expect(day2.items[1].reason).not.toBe('From your study list');
  expect(titles(day2.items)).not.toContain('Search Hard');
  // Rebuilding the day keeps the list's problem.
  const rebuilt = (
    await request('POST', `/api/daily-plans/${day2.id}/rebuild`, { version: day2.version })
  ).json();
  expect(rebuilt.items[0].title).toBe('Search Two');

  // Switched to Bloom's plan, a rebuild drops the list's unstarted problem; the list waits.
  await planFrom('bloom');
  const bloomDay = (
    await request('POST', `/api/daily-plans/${day2.id}/rebuild`, { version: rebuilt.version })
  ).json();
  expect(bloomDay.items.map((i: { reason: string }) => i.reason)).not.toContain(
    'From your study list',
  );
  expect((await request('GET', '/api/study-list')).json()).toMatchObject({
    remaining: ['Search Two'],
    finished: ['Search Hard'],
  });
  // Switched back, the next rebuild puts it first again.
  await planFrom('list');
  const listDay = (
    await request('POST', `/api/daily-plans/${day2.id}/rebuild`, { version: bloomDay.version })
  ).json();
  expect(listDay.items[0]).toMatchObject({ title: 'Search Two', status: 'active' });
});

test('Bloom fills only the slots the study list leaves, and its re-plans keep the list', async () => {
  await setList(['search-one']);
  const { run } = await bloomOn();
  const waiting = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(titles(waiting.items)).toEqual(['Search One']);
  let fromList: unknown;
  const pick = (context: Parameters<Parameters<typeof run>[0]>[0]) => {
    fromList = (context as unknown as { fromStudyList: string[] }).fromStudyList;
    expect(context.picksRequired).toBe(1);
    expect(context.candidates.map((c) => c.title)).not.toContain('Search One');
    return { summary: 'Your list, then binary search.', items: [item(1, null)] };
  };
  expect(await run(pick)).toBe(true);
  expect(fromList).toEqual(['Search One']);
  const planned = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(planned.items).toHaveLength(2);
  expect(planned.items[0]).toMatchObject({ title: 'Search One', status: 'active' });
  await request('POST', '/api/plan-drafts/today/refresh', {});
  expect(await run(pick)).toBe(true);
  const replanned = (await request('POST', '/api/daily-plan/ensure', {})).json();
  expect(titles(replanned.items)[0]).toBe('Search One');
  expect(replanned.items).toHaveLength(2);
});

test('Bloom proposes following a bundled course and handing planning back; only the host confirms', async () => {
  const courses = (await tool('get_study_list', {})).courses;
  expect(courses.map((c: { id: string }) => c.id)).toEqual([
    'hello-interview',
    'blind-75',
    'neetcode-150',
  ]);
  const blind = courses.find((c: { id: string }) => c.id === 'blind-75');
  expect(blind.sections.reduce((n: number, x: { problems: number }) => n + x.problems, 0)).toBe(75);
  // Nothing from the course in the library yet: no proposal.
  expect(
    await tool('propose_study_list', { planSource: 'list', set: 'hello-interview' }),
  ).toMatchObject({ saved: false });
  for (const title of ['Valid Parentheses', 'Decode String', 'Two Sum'])
    await request('POST', '/api/problems', {
      title,
      url: `https://leetcode.com/problems/${slug(title)}/`,
      difficulty: 'Medium',
    });
  expect(
    (
      await tool('propose_study_list', {
        planSource: 'list',
        set: 'hello-interview',
        from: 'Heaps',
      })
    ).saved,
  ).toBe(false); // unknown section: an error, not a proposal
  const { proposal } = await tool('propose_study_list', {
    planSource: 'list',
    set: 'hello-interview',
    from: 'stack',
  });
  expect(proposal).toMatchObject({
    planSource: 'list',
    name: 'Hello Interview',
    preview: { inLibrary: 2, firstUp: ['Valid Parentheses', 'Decode String'] },
  });
  expect(proposal.slugs[0]).toBe('valid-parentheses');
  const body = { change: proposal, sourceConversation: 'conversation-1' };
  expect((await request('POST', '/api/study-list/changes', body, scoped, 'tutor')).statusCode).toBe(
    403,
  );
  const following = (await request('POST', '/api/study-list/changes', body)).json();
  expect(following.list).toMatchObject({ planSource: 'list', name: 'Hello Interview' });
  expect(titles(following.plan.items).slice(0, 2)).toEqual(['Valid Parentheses', 'Decode String']);

  // A new list replaces today's unstarted list problems with its own next ones.
  const reordered = (
    await tool('propose_study_list', {
      planSource: 'list',
      // As pasted from a web page: numbered titles, a link, and a problem not in the library.
      problems: [
        '1. Decode String',
        'https://leetcode.com/problems/valid-parentheses/description/',
        '3. Min Stack',
      ],
      name: 'Stack drill',
    })
  ).proposal;
  expect(reordered.slugs).toEqual(['decode-string', 'valid-parentheses', 'min-stack']);
  const drill = (
    await request(
      'POST',
      '/api/study-list/changes',
      { change: reordered, sourceConversation: 'conversation-1' },
      'host',
      'k3',
    )
  ).json();
  expect(drill.list.name).toBe('Stack drill');
  expect(titles(drill.plan.items).slice(0, 2)).toEqual(['Decode String', 'Valid Parentheses']);

  // A NeetCode course from a section, matched loosely.
  const neet = (
    await tool('propose_study_list', { planSource: 'list', set: 'blind-75', from: 'stack' })
  ).proposal;
  expect(neet).toMatchObject({ name: 'Blind 75', preview: { firstUp: ['Valid Parentheses'] } });
  expect(neet.slugs[0]).toBe('valid-parentheses');

  // Back to Bloom: today's list problems go, the list waits; "list" alone resumes it.
  const back = (await tool('propose_study_list', { planSource: 'bloom' })).proposal;
  const bloom = (
    await request(
      'POST',
      '/api/study-list/changes',
      { change: back, sourceConversation: 'conversation-1' },
      'host',
      'k2',
    )
  ).json();
  expect(bloom.list.planSource).toBe('bloom');
  expect(bloom.plan.items.map((i: { reason: string }) => i.reason)).not.toContain(
    'From your study list',
  );
  expect((await tool('get_study_list', {})).next).toEqual(['Decode String', 'Valid Parentheses']);
  const resume = (await tool('propose_study_list', { planSource: 'list' })).proposal;
  expect(resume).toMatchObject({ planSource: 'list', name: 'Stack drill', slugs: null });
});
