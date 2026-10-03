// Per-topic training level on the problem-rating scale, replayed from completed
// attempts every time (nothing stored, so edits and imports can never leave it stale).
// Each attempt is Strong, OK or Struggled; the level moves by an Elo update against the
// problem's rating, more when the result is surprising.
import type { Problem } from '../../shared/contracts.js';
import { type Db, many } from '../db/db.js';
import { attempts, type AttemptRecord } from '../attempts/attempt-model.js';
import { problemViews } from '../catalogue/problem-model.js';
import { readSettings } from '../db/settings.js';
import { neetcodeCategories, neetcodeCategory } from './neetcode-category.js';
import { type Rating, problemRating } from './ratings.js';

export const START_LEVEL = 1300;
export const DEFAULT_TARGET = 1850;
const K = 32;
const FLOOR = 1000;

export type AttemptResult = 'strong' | 'ok' | 'struggled';
export interface Signals {
  acceptedFirstTry: boolean | null;
  difficulty: 'too_easy' | 'too_hard' | null;
}
type Recorded = Pick<AttemptRecord, 'outcome' | 'help' | 'activeSeconds' | 'confidence'>;

/** Interview pace by LeetCode label: Easy 15, Medium 25, Hard 40 minutes. */
const BUDGET_MINUTES: Record<string, number> = { Easy: 15, Medium: 25, Hard: 40 };
const STEPS: AttemptResult[] = ['struggled', 'ok', 'strong'];

/**
 * Struggled: not solved, major help or the solution, or confidence 1–2.
 * Strong: solved alone, on time, accepted first try, confidence 4–5.
 * OK: anything in between. Unanswered questions don't count against you.
 * "Too easy" / "too hard" moves the result one step.
 */
export function attemptResult(
  a: Recorded,
  difficulty: string | null,
  s?: Partial<Signals> | null,
): AttemptResult {
  const struggled =
    a.outcome !== 'solved' ||
    a.help === 'major' ||
    a.help === 'solution' ||
    (a.confidence !== null && a.confidence <= 2);
  const onTime =
    !a.activeSeconds || a.activeSeconds <= (BUDGET_MINUTES[difficulty ?? ''] ?? 25) * 60;
  const strong =
    !struggled &&
    a.help === 'none' &&
    onTime &&
    s?.acceptedFirstTry !== false &&
    (a.confidence === null || a.confidence >= 4);
  const step = struggled ? 0 : strong ? 2 : 1;
  const nudge = s?.difficulty === 'too_easy' ? 1 : s?.difficulty === 'too_hard' ? -1 : 0;
  return STEPS[Math.min(2, Math.max(0, step + nudge))]!;
}
export const resultScore = (r: AttemptResult) => (r === 'strong' ? 1 : r === 'ok' ? 0.5 : 0);
export const expectedScore = (level: number, rating: number) =>
  1 / (1 + 10 ** ((rating - level) / 400));

/** The scored topic: NeetCode's category, else a tag named after one (as scoring does). */
export function topicOf(p: Pick<Problem, 'slug' | 'tags'>): string | null {
  const category = neetcodeCategory(p);
  if (category) return category;
  const names = new Map(neetcodeCategories.map((c) => [c.toLowerCase(), c]));
  for (const t of p.tags)
    if (!t.archived && names.has(t.name.toLowerCase())) return names.get(t.name.toLowerCase())!;
  return null;
}

export const targetRating = (db: Db) =>
  readSettings(db).recommendations?.targetRating ?? DEFAULT_TARGET;

export function readSignals(db: Db): Map<string, Signals> {
  return new Map(
    many<{ attemptId: string; acceptedFirstTry: number | null; difficulty: Signals['difficulty'] }>(
      db,
      'SELECT attemptId, acceptedFirstTry, difficulty FROM attempt_signals',
    ).map((s) => [
      s.attemptId,
      {
        acceptedFirstTry: s.acceptedFirstTry === null ? null : !!s.acceptedFirstTry,
        difficulty: s.difficulty,
      },
    ]),
  );
}

/** One completed attempt with what the ladder needs. */
export interface ScoredAttempt {
  attempt: AttemptRecord;
  problem: Problem;
  topic: string;
  rating: Rating;
  result: AttemptResult;
}
export function scoredAttempts(db: Db, problems = problemViews(db)): ScoredAttempt[] {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const signals = readSignals(db);
  return attempts(
    db,
    "WHERE a.status = 'completed' AND a.outcome IS NOT NULL ORDER BY coalesce(a.finishedAt, a.startedAt), a.rowid",
  ).flatMap((attempt) => {
    const problem = byId.get(attempt.problemId);
    const topic = problem && topicOf(problem);
    const rating = problem && problemRating(db, problem);
    if (!problem || !topic || !rating) return [];
    return [
      {
        attempt,
        problem,
        topic,
        rating,
        result: attemptResult(attempt, problem.difficulty, signals.get(attempt.id)),
      },
    ];
  });
}

export interface TopicLevel {
  topic: string;
  level: number;
  atTarget: boolean;
  attempts: number;
  lastChange: {
    delta: number;
    attemptId: string;
    problem: string;
    rating: number;
    estimated: boolean;
    result: AttemptResult;
    date: string;
  } | null;
}

export function trainingLevels(db: Db, scored = scoredAttempts(db)): TopicLevel[] {
  const target = targetRating(db);
  return neetcodeCategories.map((topic) => {
    let level = START_LEVEL;
    let lastChange: TopicLevel['lastChange'] = null;
    const history = scored.filter((s) => s.topic === topic);
    for (const s of history) {
      const delta = K * (resultScore(s.result) - expectedScore(level, s.rating.value));
      level = Math.max(FLOOR, level + delta);
      lastChange = {
        delta: Math.round(delta),
        attemptId: s.attempt.id,
        problem: s.problem.title,
        rating: s.rating.value,
        estimated: s.rating.estimated,
        result: s.result,
        date: s.attempt.finishedAt ?? s.attempt.startedAt,
      };
    }
    const rounded = Math.round(level);
    return {
      topic,
      level: rounded,
      atTarget: rounded >= target,
      attempts: history.length,
      lastChange,
    };
  });
}
