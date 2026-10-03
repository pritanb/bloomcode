// What fits each topic, and which ideas are due for a check. Bloom builds the day from
// these; with the tutor off, defaultPicks does. Problems never come back themselves:
// a due review is served as a different problem (see transferSibling).
import type { Problem } from '../../shared/contracts.js';
import { type Db, many } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { studyDate } from '../attempts/attempt-model.js';
import { reviewTargets } from '../attempts/review-schedule.js';
import { problemViews } from '../catalogue/problem-model.js';
import { problemPopularity, problemRating } from '../topics/ratings.js';
import { neetcodeCategories } from '../topics/neetcode-category.js';
import { targetRating, topicOf, trainingLevels } from '../topics/training-levels.js';

export const TRANSFER_REASON = 'Transfer check — spot the approach yourself';
const NEAR = 100;
/** A same-idea check may be a little harder than the original, never far harder. */
export const CHECK_HEADROOM = 150;

export interface Candidate {
  problemId: string;
  title: string;
  topic: string | null;
  rating: number | null;
  estimated: boolean;
  popularity: number | null;
}
export interface TopicCandidates {
  topic: string;
  level: number;
  problems: Candidate[];
}
/** An attempted problem whose idea is due again: after a struggle a repair, else a transfer check. */
export interface DueCheck {
  problemId: string;
  title: string;
  topic: string | null;
  rating: number | null;
  kind: 'repair' | 'transfer';
  due: string;
}
export interface Shortlist {
  target: number;
  topics: TopicCandidates[];
  atTarget: string[];
  checks: DueCheck[];
}
export interface PlanSpec {
  problemId: string;
  title: string;
  reason: string;
  kind: 'topic' | null;
  reviewOf: string | null;
}

function candidate(db: Db, p: Problem): Candidate {
  const rating = problemRating(db, p);
  return {
    problemId: p.id,
    title: p.title,
    topic: topicOf(p),
    rating: rating?.value ?? null,
    estimated: rating?.estimated ?? true,
    popularity: problemPopularity(db, p.slug),
  };
}

/** Most popular within ±range of the aim; if too few, the closest ones fill up. */
function nearest(db: Db, pool: Problem[], aim: number, range: number, count: number) {
  const rated = pool.flatMap((p) => {
    const r = problemRating(db, p);
    return r ? [{ p, distance: Math.abs(r.value - aim) }] : [];
  });
  const near = rated
    .filter((c) => c.distance <= range)
    .sort(
      (a, b) =>
        (problemPopularity(db, b.p.slug) ?? -1) - (problemPopularity(db, a.p.slug) ?? -1) ||
        a.distance - b.distance ||
        a.p.title.localeCompare(b.p.title),
    );
  const rest = rated
    .filter((c) => c.distance > range)
    .sort((a, b) => a.distance - b.distance || a.p.title.localeCompare(b.p.title));
  return [...near, ...rest].slice(0, count).map((c) => c.p);
}

/** Problems the learner has attempted (any status); these never come back as new practice. */
export const attemptedIds = (db: Db) =>
  new Set(
    many<{ problemId: string }>(db, 'SELECT DISTINCT problemId FROM attempts').map(
      (a) => a.problemId,
    ),
  );

export function shortlist(
  db: Db,
  now: Date,
  options: { topic?: string; perTopic?: number; exclude?: Set<string>; day?: string } = {},
): Shortlist {
  const perTopic = options.perTopic ?? 5;
  const exclude = options.exclude ?? new Set<string>();
  const day = options.day ?? studyDate(now, readSettings(db).timezone);
  const target = targetRating(db);
  const problems = problemViews(db);
  const attempted = attemptedIds(db);
  const targets = reviewTargets(db);
  // Snoozed or "no review" problems wait for their date, even before a first attempt.
  const waiting = new Set(
    targets
      .filter((t) => t.action === 'none' || (t.effectiveDate !== null && t.effectiveDate > day))
      .map((t) => t.problemId),
  );
  const fresh = problems.filter(
    (p) =>
      !attempted.has(p.id) &&
      !waiting.has(p.id) &&
      !p.legacyCompleted &&
      !exclude.has(p.id) &&
      (problemRating(db, p)?.value ?? Infinity) <= target,
  );
  const byTopic = new Map<string, Problem[]>();
  for (const p of fresh) {
    const topic = topicOf(p);
    if (topic) byTopic.set(topic, [...(byTopic.get(topic) ?? []), p]);
  }
  const levels = trainingLevels(db);
  const topics = levels
    .filter((l) => !l.atTarget && (!options.topic || l.topic === options.topic))
    // Weakest first; ties go fundamentals first (NeetCode's category order).
    .sort(
      (a, b) =>
        a.level - b.level ||
        neetcodeCategories.indexOf(a.topic) - neetcodeCategories.indexOf(b.topic),
    )
    .map((l) => ({
      topic: l.topic,
      level: l.level,
      problems: nearest(db, byTopic.get(l.topic) ?? [], l.level, NEAR, perTopic).map((p) =>
        candidate(db, p),
      ),
    }))
    .filter((t) => t.problems.length);
  const live = new Set(
    many<{ problemId: string }>(
      db,
      "SELECT problemId FROM attempts WHERE status != 'completed'",
    ).map((a) => a.problemId),
  );
  const byId = new Map(problems.map((p) => [p.id, p]));
  const checks = targets
    .filter((t) => t.effectiveDate && t.effectiveDate <= day && !live.has(t.problemId))
    .flatMap((t) => {
      const p = byId.get(t.problemId);
      // Only ideas you have practised come back; a snoozed new problem is just new again.
      if (!p || !p.attemptCount || (options.topic && topicOf(p) !== options.topic)) return [];
      const c = candidate(db, p);
      return [
        {
          problemId: p.id,
          title: p.title,
          topic: c.topic,
          rating: c.rating,
          kind: t.stage === 'repair' ? ('repair' as const) : ('transfer' as const),
          due: t.effectiveDate!,
        },
      ];
    })
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  return { target, topics, atTarget: levels.filter((l) => l.atTarget).map((l) => l.topic), checks };
}

/**
 * Whether a problem is a fair transfer check for an idea: never attempted or viewed (so
 * the attempt is genuinely unseen), and not far harder than the original or the target.
 */
export function fairCheck(
  db: Db,
  p: Problem,
  original: DueCheck,
  exclude: Set<string>,
  attempted = attemptedIds(db),
) {
  const rating = problemRating(db, p);
  const ceiling = Math.min(
    targetRating(db),
    (original.rating ?? targetRating(db)) + CHECK_HEADROOM,
  );
  return (
    p.id !== original.problemId &&
    !exclude.has(p.id) &&
    !p.exposed &&
    !p.legacyCompleted &&
    !attempted.has(p.id) &&
    !!rating &&
    rating.value <= ceiling
  );
}

/** Without Bloom: the most popular fair problem from the same topic near the original. */
export function transferSibling(db: Db, original: DueCheck, exclude: Set<string>) {
  if (!original.topic) return null;
  const attempted = attemptedIds(db);
  const pool = problemViews(db).filter(
    (p) => topicOf(p) === original.topic && fairCheck(db, p, original, exclude, attempted),
  );
  return nearest(db, pool, original.rating ?? 0, CHECK_HEADROOM, 1)[0] ?? null;
}

/**
 * A due idea served without a same-idea problem from Bloom: visible practice in the same
 * topic after the earlier problem (easier after a struggle). Only Bloom knows which
 * problems share an idea, so only Bloom's picks become hidden transfer checks.
 */
export function practiceAfter(
  db: Db,
  list: Shortlist,
  check: DueCheck,
  used: Set<string>,
): PlanSpec | null {
  if (check.kind === 'repair') {
    const easier = list.topics
      .find((t) => t.topic === check.topic)
      ?.problems.find((p) => !used.has(p.problemId));
    return easier
      ? {
          problemId: easier.problemId,
          title: easier.title,
          reason: `${check.topic} · easier practice after ${check.title}`,
          kind: 'topic',
          reviewOf: check.problemId,
        }
      : null;
  }
  const sibling = transferSibling(db, check, used);
  return sibling
    ? {
        problemId: sibling.id,
        title: sibling.title,
        reason: `${check.topic} · practice after ${check.title}`,
        kind: 'topic',
        reviewOf: check.problemId,
      }
    : null;
}

/** The day without a model: due checks first, then the weakest topics, one problem each. */
export function defaultPicks(
  db: Db,
  list: Shortlist,
  slots: number,
  exclude: Set<string>,
  checked = new Set<string>(),
) {
  const picks: PlanSpec[] = [];
  const used = new Set(exclude);
  const take = (spec: PlanSpec) => {
    used.add(spec.problemId);
    picks.push(spec);
  };
  for (const check of list.checks) {
    if (picks.length >= slots) break;
    if (checked.has(check.problemId)) continue;
    const spec = practiceAfter(db, list, check, used);
    if (spec) take(spec);
  }
  // One problem per topic per round, weakest topics first.
  for (let added = true; added && picks.length < slots;) {
    added = false;
    for (const t of list.topics) {
      if (picks.length >= slots) break;
      const p = t.problems.find((x) => !used.has(x.problemId));
      if (!p) continue;
      take({
        problemId: p.problemId,
        title: p.title,
        reason: `${t.topic} · your level ${t.level}`,
        kind: 'topic',
        reviewOf: null,
      });
      added = true;
    }
    if (!added) break;
  }
  return picks;
}
