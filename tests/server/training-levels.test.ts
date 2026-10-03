import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { attemptResult, expectedScore } from '../../src/server/topics/training-levels.js';

const solved = {
  outcome: 'solved' as const,
  help: 'none' as const,
  activeSeconds: 600,
  confidence: 4,
};

test('each attempt is Strong, OK or Struggled; feedback moves it one step', () => {
  expect(attemptResult(solved, 'Medium')).toBe('strong');
  // Unanswered questions don't count against you.
  expect(attemptResult({ ...solved, activeSeconds: null, confidence: null }, 'Medium')).toBe(
    'strong',
  );
  // Any shortfall makes it OK: a hint, too slow, not first try, middling confidence.
  expect(attemptResult({ ...solved, help: 'small' }, 'Medium')).toBe('ok');
  expect(attemptResult({ ...solved, activeSeconds: 30 * 60 }, 'Medium')).toBe('ok');
  expect(attemptResult({ ...solved, activeSeconds: 30 * 60 }, 'Hard')).toBe('strong');
  expect(attemptResult(solved, 'Medium', { acceptedFirstTry: false })).toBe('ok');
  expect(attemptResult({ ...solved, confidence: 3 }, 'Medium')).toBe('ok');
  // Struggled: not solved, major help or the solution, or low confidence.
  expect(attemptResult({ ...solved, outcome: 'not_solved' }, 'Medium')).toBe('struggled');
  expect(attemptResult({ ...solved, help: 'major' }, 'Medium')).toBe('struggled');
  expect(attemptResult({ ...solved, confidence: 2 }, 'Medium')).toBe('struggled');
  // Feedback is one step, never the whole verdict.
  expect(attemptResult(solved, 'Medium', { difficulty: 'too_hard' })).toBe('ok');
  expect(attemptResult({ ...solved, help: 'small' }, 'Medium', { difficulty: 'too_easy' })).toBe(
    'strong',
  );
  expect(
    attemptResult({ ...solved, outcome: 'not_solved' }, 'Medium', { difficulty: 'too_easy' }),
  ).toBe('ok');
});

test('Elo moves little on misses far above the level and more on misses at or below it', () => {
  const delta = (level: number, rating: number, score: number) =>
    Math.round(32 * (score - expectedScore(level, rating)));
  expect(delta(1600, 2097, 0)).toBe(-2);
  expect(delta(1600, 1600, 0)).toBe(-16);
  expect(delta(1600, 1450, 0)).toBe(-23);
  expect(delta(1600, 1600, 1)).toBe(16);
  expect(delta(1600, 1600, 0.5)).toBe(0);
});

let app: Awaited<ReturnType<typeof createApp>>, dir: string, scoped: string;
const request = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  token = 'host',
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-ladder-'));
  app = await createApp({
    dbPath: join(dir, 'study.sqlite'),
    token: 'host',
    clock: () => new Date('2026-10-01T09:00:00Z'),
  });
  scoped = readFileSync(join(dir, 'tutor-token'), 'utf8').trim();
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
/** Problems imported like the problem bank: tagged with a topic, rated, unseen. */
const bank = (problems: { slug: string; difficulty: string; topic: string }[]) =>
  request('POST', '/api/import', {
    importId: crypto.randomUUID(),
    dryRun: false,
    source: { retrievedAt: '2026-10-01T00:00:00Z' },
    problems: problems.map((p) => ({
      key: p.slug,
      title: p.slug,
      url: `https://leetcode.com/problems/${p.slug}/`,
      difficulty: p.difficulty,
      tags: [p.topic],
    })),
    attempts: [],
    topics: [],
    movements: [],
    records: [],
  });
const idOf = async (slug: string) =>
  (await request('GET', `/api/problems?search=${slug}`)).json().items[0].id as string;
async function attempt(problemId: string, result: object) {
  const a = (
    await request('POST', '/api/attempts', { problemId, context: 'targeted', language: 'python' })
  ).json();
  expect(
    (await request('POST', `/api/attempts/${a.id}/finish`, { version: a.version, ...result }))
      .statusCode,
  ).toBe(200);
  return a.id as string;
}
const level = async (topic: string) =>
  (await request('GET', '/api/training-levels', undefined, scoped))
    .json()
    .levels.find((l: { topic: string }) => l.topic === topic);

test('a struggle lowers only that topic and feedback adjusts the result', async () => {
  // koko-eating-bananas: Binary Search, exact contest rating 1,766.
  await bank([
    { slug: 'koko-eating-bananas', difficulty: 'Medium', topic: 'Binary Search' },
    { slug: 'binary-search', difficulty: 'Easy', topic: 'Binary Search' },
  ]);
  expect((await level('Binary Search')).level).toBe(1300);
  await attempt(await idOf('koko-eating-bananas'), {
    outcome: 'not_solved',
    help: 'major',
    activeSeconds: 1800,
  });
  const after = await level('Binary Search');
  // Expected only ~6% at 1,300 against 1,766, so a miss barely moves the level.
  expect(after.level).toBe(1298);
  expect(after.lastChange).toMatchObject({
    problem: 'koko-eating-bananas',
    rating: 1766,
    result: 'struggled',
  });
  expect((await level('Graphs')).level).toBe(1300);

  const id = await attempt(await idOf('binary-search'), {
    outcome: 'solved',
    help: 'none',
    activeSeconds: 300,
    confidence: 5,
  });
  const strong = await level('Binary Search');
  expect(strong.lastChange.result).toBe('strong');
  expect(
    (
      await request('PATCH', `/api/attempts/${id}/signals`, {
        acceptedFirstTry: false,
        difficulty: 'too_hard',
      })
    ).json(),
  ).toEqual({ acceptedFirstTry: false, difficulty: 'too_hard' });
  // Not first try (OK) and "too hard" (one step down): now Struggled.
  const lowered = await level('Binary Search');
  expect(lowered.lastChange.result).toBe('struggled');
  expect(lowered.level).toBeLessThan(strong.level);
});

test('candidates are the most popular unseen problems near your level, else the closest, never above target', async () => {
  await bank([
    { slug: 'obscure-near', difficulty: 'Easy', topic: 'Graphs' },
    { slug: 'famous-near', difficulty: 'Easy', topic: 'Graphs' },
    { slug: 'graph-hard', difficulty: 'Hard', topic: 'Graphs' },
    // Nothing near a new learner: the closest ones are offered.
    { slug: 'advanced-a', difficulty: 'Medium', topic: 'Advanced Graphs' },
    { slug: 'advanced-b', difficulty: 'Medium', topic: 'Advanced Graphs' },
  ]);
  const db = app.tutorJobs.db;
  for (const [slug, percentile] of [
    ['obscure-near', 20],
    ['famous-near', 97],
  ] as const)
    db.prepare(
      'INSERT INTO problem_popularity (slug, likes, dislikes, percentile) VALUES (?, 0, 0, ?)',
    ).run(slug, percentile);
  const list = (await request('GET', '/api/recommendations/shortlist', undefined, scoped)).json();
  const topic = (name: string) => list.topics.find((t: { topic: string }) => t.topic === name);
  const titles = (name: string) => topic(name).problems.map((p: { title: string }) => p.title);
  expect(titles('Graphs')[0]).toBe('famous-near');
  expect(topic('Graphs').problems[0].popularity).toBe(97);
  // Hard (≈2,262) is above the 1,850 target: never offered.
  expect(titles('Graphs')).not.toContain('graph-hard');
  expect(titles('Advanced Graphs')).toEqual(['advanced-a', 'advanced-b']);
  // Weakest first; equal levels go in fundamentals-first order (Graphs before Advanced Graphs).
  const order = list.topics.map((t: { topic: string }) => t.topic);
  expect(order.indexOf('Graphs')).toBeLessThan(order.indexOf('Advanced Graphs'));

  await request('PATCH', '/api/settings', { recommendations: { targetRating: 1300 } });
  const capped = (await request('GET', '/api/recommendations/shortlist')).json();
  for (const t of capped.topics)
    for (const p of t.problems) expect(p.rating).toBeLessThanOrEqual(1300);
});
