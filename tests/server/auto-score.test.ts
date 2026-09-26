import { afterEach, expect, it } from 'vitest';
import { readTables } from '../tables.js';
import { createApp } from '../../src/server/core/app.js';
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
async function fixture(topicScore: number | null) {
  const app = await createApp({
    dbPath: ':memory:',
    token: 'test',
    clock: () => new Date('2026-09-16T01:00:00Z'),
  });
  apps.push(app);
  const request = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, key?: string) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': key ?? crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  // Real NeetCode 250 slugs: the manifest category, not the tag, drives scoring.
  await request('POST', '/api/import', {
    importId: 'fixture',
    dryRun: false,
    source: { retrievedAt: '2026-09-16T00:00:00Z' },
    problems: [
      {
        key: 'fresh',
        title: 'Fresh Problem',
        url: 'https://leetcode.com/problems/contains-duplicate/',
        tags: ['Some Personal Label'],
      },
      {
        key: 'seen',
        title: 'Seen Problem',
        url: 'https://leetcode.com/problems/two-sum/',
        tags: ['Some Personal Label'],
        legacyCompleted: true,
      },
    ],
    attempts: [],
    topics: [{ name: 'Arrays & Hashing', score: topicScore, notes: '', provisional: true }],
    movements: [],
    records: [],
  });
  // /api/problems discloses pattern metadata, so read the table directly.
  const problems = readTables(app.tutorJobs.db).problems as {
    id: string;
    title: string;
  }[];
  const topic = (await request('GET', '/api/topics')).json()[0] as { id: string; score: number };
  async function finish(
    title: string,
    context: 'mixed' | 'targeted' | 'review',
    body: {
      outcome: 'solved' | 'not_solved' | 'stopped';
      help: 'none' | 'small' | 'major' | 'solution' | 'unknown';
    },
    key?: string,
  ) {
    const p = problems.find((x) => x.title === title)!;
    const a = (await request('POST', '/api/attempts', { problemId: p.id, context })).json() as {
      id: string;
      version: number;
      studyDate: string;
    };
    const done = await request(
      'POST',
      `/api/attempts/${a.id}/finish`,
      { version: a.version, ...body, activeSeconds: 60 },
      key,
    );
    return { attempt: a, response: done };
  }
  const decisions = async () =>
    (await request('GET', `/api/topics/${topic.id}`)).json().decisions as {
      oldScore: number;
      newScore: number;
      rationale: string;
      evidence: string;
      attemptId: string | null;
    }[];
  return { request, topic, finish, decisions };
}
it('raises the score on an independent unseen solve and links the decision to the attempt', async () => {
  const { request, topic, finish, decisions } = await fixture(2.8);
  const { attempt } = await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  const after = (await request('GET', '/api/topics')).json()[0];
  expect(after.score).toBe(3);
  expect(after.provisional).toBe(false);
  const all = await decisions();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({
    oldScore: 2.8,
    newScore: 3,
    evidence: 'unseen',
    attemptId: attempt.id,
  });
  expect(all[0].rationale).toContain('Auto:');
  const detail = (await request('GET', `/api/topics/${topic.id}`)).json();
  expect(detail.attempts.map((a: { id: string }) => a.id)).toContain(attempt.id);
});
it('caps targeted and retention evidence at 3', async () => {
  const { request, finish, decisions } = await fixture(3);
  await finish('Seen Problem', 'targeted', { outcome: 'solved', help: 'none' });
  expect(await decisions()).toHaveLength(0);
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(3);
});
it('never lowers a score that already sits above the cap when an attempt is solved', async () => {
  const { request, finish, decisions } = await fixture(3.75);
  await finish('Seen Problem', 'review', { outcome: 'solved', help: 'none' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(3.75);
  expect(await decisions()).toHaveLength(0);
});
it('moves 0.1 on a small hint and nothing on a major hint', async () => {
  const { request, finish, decisions } = await fixture(2.8);
  await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'small' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.9);
  await finish('Seen Problem', 'targeted', { outcome: 'solved', help: 'major' });
  expect((await decisions()).filter((d) => d.newScore !== 2.9)).toHaveLength(0);
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.9);
});
it('lowers the score on a retention miss but not on an unseen miss', async () => {
  const { request, finish, decisions } = await fixture(2.8);
  await finish('Seen Problem', 'review', { outcome: 'not_solved', help: 'unknown' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.65);
  await finish('Fresh Problem', 'mixed', { outcome: 'not_solved', help: 'unknown' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.65);
  expect(await decisions()).toHaveLength(1);
});
it('does nothing when automatic scoring is disabled', async () => {
  const { request, finish, decisions } = await fixture(2.8);
  expect((await request('PATCH', '/api/settings', { autoScore: false })).statusCode).toBe(200);
  await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.8);
  expect(await decisions()).toHaveLength(0);
});
it('applies exactly once across idempotent finish retries', async () => {
  const { request, finish, decisions } = await fixture(2.8);
  const key = crypto.randomUUID();
  const { attempt, response } = await finish(
    'Fresh Problem',
    'mixed',
    { outcome: 'solved', help: 'none' },
    key,
  );
  expect(response.statusCode).toBe(200);
  const retry = await request(
    'POST',
    `/api/attempts/${attempt.id}/finish`,
    { version: attempt.version, outcome: 'solved', help: 'none', activeSeconds: 60 },
    key,
  );
  expect(retry.statusCode).toBe(200);
  expect(await decisions()).toHaveLength(1);
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(3);
});
it('returns the recorded score movements with the saved attempt so the app can show them', async () => {
  const { request, finish } = await fixture(2.8);
  const { attempt } = await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  const saved = (await request('GET', `/api/attempts/${attempt.id}`)).json();
  expect(saved.scoreDecisions).toHaveLength(1);
  expect(saved.scoreDecisions[0]).toMatchObject({
    topicName: 'Arrays & Hashing',
    oldScore: 2.8,
    newScore: 3,
  });
});
it('records a tutor note without touching scores when decisions are omitted', async () => {
  const { request, finish } = await fixture(2.8);
  const { attempt } = await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  const saved = (await request('GET', `/api/attempts/${attempt.id}`)).json();
  const scoreBefore = (await request('GET', '/api/topics')).json()[0].score;
  const note = 'Clean derivation. Work on stating the invariant before coding.';
  const result = await request('POST', `/api/attempts/${attempt.id}/reviews`, {
    version: saved.version,
    feedback: note,
  });
  expect(result.statusCode).toBe(200);
  const after = (await request('GET', `/api/attempts/${attempt.id}`)).json();
  expect(after.feedback).toBe(note);
  // The automatic movement stands; omitting decisions must not re-score.
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(scoreBefore);
  expect(after.scoreDecisions).toHaveLength(1);
});
it('skips topics without a current score', async () => {
  const { finish, decisions } = await fixture(null);
  await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  expect(await decisions()).toHaveLength(0);
});
it('scores by NeetCode category, so a personal tag never decides the topic', async () => {
  const { request, finish, decisions } = await fixture(2.8);
  // The question is tagged "Some Personal Label" and there is no such topic;
  // its NeetCode category (Arrays & Hashing) is what moves.
  await finish('Fresh Problem', 'mixed', { outcome: 'solved', help: 'none' });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(3);
  expect((await decisions())[0]).toMatchObject({ topicName: 'Arrays & Hashing' });
  expect((await request('GET', '/api/tags')).json().map((t: { name: string }) => t.name)).toEqual([
    'Some Personal Label',
  ]);
});
it('falls back to a topic-named tag for a question outside the verified lists', async () => {
  const app = await createApp({ dbPath: ':memory:', token: 'test' });
  apps.push(app);
  const request = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer test', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  await request('POST', '/api/import', {
    importId: 'f',
    dryRun: false,
    source: { retrievedAt: '2026-09-16T00:00:00Z' },
    problems: [
      {
        key: 'custom',
        title: 'Custom',
        url: 'https://leetcode.com/problems/some-unlisted-question/',
        tags: ['Trees'],
      },
    ],
    attempts: [],
    topics: [{ name: 'Trees', score: 2.5, notes: '', provisional: true }],
    movements: [],
    records: [],
  });
  const p = readTables(app.tutorJobs.db).problems[0] as { id: string };
  const a = (await request('POST', '/api/attempts', { problemId: p.id, context: 'mixed' })).json();
  await request('POST', `/api/attempts/${a.id}/finish`, {
    version: a.version,
    outcome: 'solved',
    help: 'none',
    activeSeconds: 60,
  });
  expect((await request('GET', '/api/topics')).json()[0].score).toBe(2.7);
});
