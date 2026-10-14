import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import {
  BANK_LIST,
  buildProblemBank,
  categoryFor,
  popularityOf,
  type LeetCodeQuestion,
} from '../../src/integrations/problem-bank.js';
import { applyProblemBank } from '../../src/server/catalogue/problem-bank.js';
import { many, run } from '../../src/server/db/db.js';

const q = (
  titleSlug: string,
  tags: string[],
  difficulty: LeetCodeQuestion['difficulty'] = 'Medium',
  extra: Partial<LeetCodeQuestion> = {},
): LeetCodeQuestion => ({
  title: titleSlug.replaceAll('-', ' '),
  titleSlug,
  difficulty,
  acRate: 50,
  isPaidOnly: false,
  topicTags: tags.map((name) => ({ name })),
  ...extra,
});

test('maps LeetCode tags to the NeetCode category the ladder scores', () => {
  expect(categoryFor(q('x', ['Array', 'Union Find', 'Graph']))).toBe('Advanced Graphs');
  expect(categoryFor(q('x', ['Tree', 'Depth-First Search']))).toBe('Trees');
  expect(categoryFor(q('x', ['Dynamic Programming', 'Matrix']))).toBe('2-D Dynamic Programming');
  expect(categoryFor(q('x', ['Backtracking', 'Dynamic Programming']))).toBe('Backtracking');
  // A real trie problem stays Tries; a trie that only speeds up a DP's word lookups is DP.
  expect(categoryFor(q('replace-words', ['Array', 'Hash Table', 'String', 'Trie']))).toBe('Tries');
  expect(
    categoryFor(
      q('extra-characters-in-a-string', [
        'Array',
        'Hash Table',
        'String',
        'Dynamic Programming',
        'Trie',
      ]),
    ),
  ).toBe('1-D Dynamic Programming');
  expect(categoryFor(q('x', ['Array', 'Binary Search']))).toBe('Binary Search');
  expect(categoryFor(q('x', ['Array', 'Hash Table']))).toBe('Arrays & Hashing');
  // NeetCode's own category wins for its problems.
  expect(categoryFor(q('koko-eating-bananas', ['Array']))).toBe('Binary Search');
});

test('popularity is the likes percentile among algorithm problems', () => {
  const pop = popularityOf([
    q('a', [], 'Easy', { likes: 10, dislikes: 1 }),
    q('b', [], 'Easy', { likes: 100, dislikes: 5 }),
    q('c', [], 'Easy', { likes: 1000, dislikes: 10 }),
    q('d', [], 'Easy', { likes: 1000, dislikes: 2000 }),
  ]);
  expect(pop.map((p) => p.percentile)).toEqual([25, 50, 100, 100]);
});

// 60 rated contest-style rows for the fit, plus classics without contest ratings.
const rated = Array.from({ length: 60 }, (_, i) =>
  q(`rated-${i}`, i % 2 ? ['Graph'] : ['Array'], (['Easy', 'Medium', 'Hard'] as const)[i % 3], {
    acRate: 30 + (i % 40),
  }),
);
const exact = new Map(
  rated.map((r, i) => [r.titleSlug, [1250, 1650, 2250][i % 3]! - (r.acRate - 50) * 4]),
);
const classics = [
  q('classic-easy', ['Hash Table'], 'Easy', { acRate: 60 }),
  q('classic-premium', ['Stack'], 'Medium', { isPaidOnly: true }),
  q('classic-hard', ['Graph'], 'Hard', { acRate: 20 }),
  q('second-highest-salary', ['Database'], 'Medium'),
];

let app: Awaited<ReturnType<typeof createApp>>, dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bloom-bank-'));
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('builds the bank up to the cap with estimates, keeping existing work and replacing estimates atomically', async () => {
  const request = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer host', 'idempotency-key': crypto.randomUUID() },
      ...(payload ? { payload } : {}),
    });
  // An existing problem with saved work and the user's own title.
  const mine = (
    await request('POST', '/api/problems', {
      title: 'My Easy Classic',
      url: 'https://leetcode.com/problems/classic-easy/',
    })
  ).json();
  const a = (
    await request('POST', '/api/attempts', { problemId: mine.id, context: 'targeted' })
  ).json();
  await request('POST', `/api/attempts/${a.id}/finish`, {
    version: a.version,
    outcome: 'solved',
    help: 'none',
    activeSeconds: 300,
  });

  const bank = buildProblemBank([...rated, ...classics], exact, '2026-10-01T00:00:00Z');
  expect(bank.model.heldOutError).toBeLessThan(60);
  const slugs = bank.payload.problems.map((p) => p.key);
  expect(slugs).toContain('classic-easy');
  expect(slugs).toContain('classic-premium'); // premium included
  expect(slugs).not.toContain('classic-hard'); // estimated above 2,000
  expect(slugs).not.toContain('second-highest-salary'); // SQL, not an algorithm problem
  expect(bank.estimates.map((e) => e.slug).sort()).toEqual(
    ['classic-easy', 'classic-hard', 'classic-premium', 'second-highest-salary'].sort(),
  );

  const db = app.tutorJobs.db;
  applyProblemBank(db, bank, () => new Date('2026-10-01T00:00:00Z'));
  const problems = (await request('GET', `/api/problems?pageSize=100`)).json().items as {
    slug: string;
    title: string;
    lists: { name: string }[];
    tags: { name: string }[];
    leetcodeTopics?: string[];
    rating?: { value: number; estimated: boolean };
  }[];
  const classic = problems.find((p) => p.slug === 'classic-easy')!;
  expect(classic.title).toBe('My Easy Classic'); // never overwritten
  expect(classic.lists.map((l) => l.name)).toContain(BANK_LIST);
  expect(classic.leetcodeTopics).toEqual(['Hash Table']);
  expect(classic.rating?.estimated).toBe(true);
  const graph = problems.find((p) => p.slug === 'rated-1')!;
  expect(graph.tags.map((t) => t.name)).toEqual(['Graphs']);
  expect((await request('GET', `/api/attempts/${a.id}`)).json().outcome).toBe('solved');
  expect(many(db, 'SELECT count(*) AS n FROM problem_popularity')).toEqual([
    { n: rated.length + classics.length - 1 }, // the SQL problem has no popularity row
  ]);

  // A refresh replaces every estimate; a failed apply leaves the old ones in place.
  const before = many(db, 'SELECT * FROM rating_estimates ORDER BY slug');
  expect(() =>
    applyProblemBank(
      db,
      { ...bank, payload: { ...bank.payload, importId: 'x', problems: [{} as never] } },
      () => new Date(),
    ),
  ).toThrow();
  expect(many(db, 'SELECT * FROM rating_estimates ORDER BY slug')).toEqual(before);
});

test('a database from before the Trie + DP rule moves those bank problems to DP once', async () => {
  const wordDp = q('extra-characters-in-a-string', ['String', 'Dynamic Programming', 'Trie']),
    realTrie = q('replace-words', ['String', 'Trie']);
  const bank = buildProblemBank([...rated, wordDp, realTrie], exact, '2026-10-01T00:00:00Z');
  applyProblemBank(app.tutorJobs.db, bank, () => new Date('2026-10-01T00:00:00Z'));
  const topicsOf = (slug: string) =>
    many<{ name: string }>(
      app.tutorJobs.db,
      `SELECT t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tagId
       JOIN problems p ON p.id = pt.problemId WHERE p.slug = ?`,
      slug,
    ).map((t) => t.name);
  expect(topicsOf('extra-characters-in-a-string')).toEqual(['1-D Dynamic Programming']);
  // What the old rule saved: the word-lookup DP filed under Tries.
  run(
    app.tutorJobs.db,
    `UPDATE problem_tags SET tagId = (SELECT id FROM tags WHERE name = 'Tries')
     WHERE problemId = (SELECT id FROM problems WHERE slug = 'extra-characters-in-a-string')`,
  );
  app.tutorJobs.db.pragma('user_version = 12');
  await app.close();
  app = await createApp({ dbPath: join(dir, 'study.sqlite'), token: 'host' });
  expect(topicsOf('extra-characters-in-a-string')).toEqual(['1-D Dynamic Programming']);
  expect(topicsOf('replace-words')).toEqual(['Tries']);
});
