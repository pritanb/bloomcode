// The LeetCode problem bank: every problem rated up to the cap (exact contest rating or
// fitted estimate), tagged with the NeetCode category the training ladder scores it under.
// LeetCode metadata is fetched on the learner's machine and never committed.
import { createHash } from 'node:crypto';
import type { ImportPayload } from '../shared/contracts.js';
import { neetcodeSourceRows } from '../server/topics/neetcode-category.js';
import { fitRatingModel, type RatingModel } from './rating-model.js';

export const BANK_LIST = 'LeetCode problem bank';
export const BANK_CAP = 2000;

export interface LeetCodeQuestion {
  title: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  acRate: number;
  isPaidOnly: boolean;
  likes?: number;
  dislikes?: number;
  topicTags: { name: string }[];
}

// First match wins: specific structures before general techniques; Arrays & Hashing last.
const PRIORITY: [string[], string][] = [
  [['Trie'], 'Tries'],
  [['Union Find', 'Shortest Path', 'Minimum Spanning Tree', 'Topological Sort'], 'Advanced Graphs'],
  [['Tree', 'Binary Tree', 'Binary Search Tree'], 'Trees'],
  [['Graph', 'Breadth-First Search', 'Depth-First Search'], 'Graphs'],
  [['Heap (Priority Queue)'], 'Heap / Priority Queue'],
  [['Backtracking'], 'Backtracking'],
  [['Binary Search'], 'Binary Search'],
  [['Sliding Window'], 'Sliding Window'],
  [['Two Pointers'], 'Two Pointers'],
  [['Stack', 'Monotonic Stack'], 'Stack'],
  [['Linked List'], 'Linked List'],
  [['Line Sweep'], 'Intervals'],
  [['Greedy'], 'Greedy'],
  [['Bit Manipulation'], 'Bit Manipulation'],
  [['Math', 'Geometry'], 'Math & Geometry'],
];

const dpCategory = (tags: Set<string>) =>
  tags.has('Matrix') ? '2-D Dynamic Programming' : '1-D Dynamic Programming';

/** NeetCode's own category when it has one, else the priority table. */
export function categoryFor(q: Pick<LeetCodeQuestion, 'titleSlug' | 'topicTags'>): string {
  const own = neetcodeSourceRows.get(q.titleSlug)?.topic;
  if (own) return own;
  const tags = new Set(q.topicTags.map((t) => t.name));
  // A trie beside DP only speeds up word lookups inside the DP (Extra Characters in a
  // String), so the problem is DP practice, not Tries practice.
  if (tags.has('Trie') && tags.has('Dynamic Programming')) return dpCategory(tags);
  // DP comes after the structures and backtracking that define a problem's shape.
  for (const [names, category] of PRIORITY.slice(0, 6))
    if (names.some((n) => tags.has(n))) return category;
  if (tags.has('Dynamic Programming')) return dpCategory(tags);
  for (const [names, category] of PRIORITY.slice(6))
    if (names.some((n) => tags.has(n))) return category;
  return 'Arrays & Hashing';
}

// Interview coding screens are algorithm problems; never offer SQL, shell or concurrency.
const NOT_ALGORITHMS = new Set(['Database', 'Shell', 'Concurrency']);
const isAlgorithm = (q: LeetCodeQuestion) => !q.topicTags.some((t) => NOT_ALGORITHMS.has(t.name));

/**
 * How likely a problem is to come up in interviews, from LeetCode's public likes: the
 * percentile of likes among algorithm problems (NeetCode 150 problems sit at a median of
 * ~97, obscure contest problems near 40).
 */
export function popularityOf(questions: LeetCodeQuestion[]) {
  const sorted = questions.map((q) => q.likes ?? 0).sort((a, b) => a - b);
  const atOrBelow = (v: number) => {
    let lo = 0,
      hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return questions.map((q) => ({
    slug: q.titleSlug,
    likes: q.likes ?? 0,
    dislikes: q.dislikes ?? 0,
    percentile: Math.round((atOrBelow(q.likes ?? 0) / Math.max(1, sorted.length)) * 100),
  }));
}

export interface ProblemBank {
  model: RatingModel;
  estimates: { slug: string; rating: number }[];
  popularity: { slug: string; likes: number; dislikes: number; percentile: number }[];
  payload: ImportPayload;
}

export function buildProblemBank(
  questions: LeetCodeQuestion[],
  exact: Map<string, number>,
  retrievedAt: string,
  cap = BANK_CAP,
): ProblemBank {
  const features = (q: LeetCodeQuestion) => ({
    difficulty: q.difficulty,
    acRate: q.acRate,
    tags: q.topicTags.map((t) => t.name),
  });
  const model = fitRatingModel(
    questions
      .filter((q) => exact.has(q.titleSlug))
      .map((q) => ({ ...features(q), rating: exact.get(q.titleSlug)! })),
  );
  const estimates = questions
    .filter((q) => !exact.has(q.titleSlug))
    .map((q) => ({ slug: q.titleSlug, rating: Math.round(model.predict(features(q))) }));
  const rating = new Map([...exact, ...estimates.map((e) => [e.slug, e.rating] as const)]);
  const problems = questions
    .filter((q) => (rating.get(q.titleSlug) ?? Infinity) <= cap && isAlgorithm(q))
    .sort((a, b) => a.titleSlug.localeCompare(b.titleSlug))
    .map((q) => ({
      key: q.titleSlug,
      title: q.title,
      url: `https://leetcode.com/problems/${q.titleSlug}/`,
      difficulty: q.difficulty,
      tags: [categoryFor(q)],
      lists: [BANK_LIST],
      leetcodeTopics: q.topicTags.map((t) => t.name).slice(0, 30),
    }));
  const digest = createHash('sha256').update(JSON.stringify(problems)).digest('hex');
  return {
    model,
    estimates,
    popularity: popularityOf(questions.filter(isAlgorithm)),
    payload: {
      importId: `problem-bank-v1-${digest}`,
      dryRun: false,
      source: { retrievedAt },
      problems,
      attempts: [],
      topics: [],
      movements: [],
      records: [],
    },
  };
}

const QUERY = `query bank($skip: Int, $limit: Int) {
  questionList(categorySlug: "algorithms", limit: $limit, skip: $skip, filters: {}) {
    totalNum
    data { title titleSlug difficulty acRate isPaidOnly likes dislikes topicTags { name } }
  }
}`;

/** Page through LeetCode's public algorithm problems (about 37 requests). No credentials. */
export async function fetchLeetCodeQuestions(
  fetcher: typeof fetch = fetch,
  delayMs = 300,
  signal?: AbortSignal,
): Promise<LeetCodeQuestion[]> {
  const out: LeetCodeQuestion[] = [];
  for (let skip = 0, total = Infinity; skip < total; skip += 100) {
    const res = await fetcher('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'https://leetcode.com' },
      body: JSON.stringify({ query: QUERY, variables: { skip, limit: 100 } }),
      signal,
    });
    if (!res.ok) throw Error(`LeetCode returned ${res.status} while listing problems.`);
    const body = (await res.json()) as {
      data?: { questionList?: { totalNum: number; data: LeetCodeQuestion[] } };
    };
    const page = body.data?.questionList;
    if (!page) throw Error('LeetCode returned an unexpected problem listing.');
    total = page.totalNum;
    out.push(...page.data);
    if (skip + 100 < total) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}
