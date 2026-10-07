import type { ScoreDecision } from '../../shared/contracts.js';
import type { AttemptRecord } from '../attempts/attempt-model.js';
import { getProblem, problemTags } from '../catalogue/problem-model.js';
import { neetcodeCategory } from '../topics/neetcode-category.js';
import type { Db } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { topicRows } from '../topics/topic-model.js';
import { recordDecision } from './review-model.js';

// Conservative automatic movements applied when an attempt finishes.
// Increases above 3 stay reserved for independent unseen solves, matching
// the manual review guard in scoring.ts. Manual reviews can still override.
// Solves scale with difficulty (Easy half, Hard one and a half); a question
// with no recorded difficulty counts as Medium.
export function autoScoreDelta(a: AttemptRecord, difficulty: string | null = null): number {
  if (a.outcome === 'solved') {
    const weight = difficulty === 'Easy' ? 0.5 : difficulty === 'Hard' ? 1.5 : 1;
    if (a.help === 'none') return 0.2 * weight;
    if (a.help === 'small') return 0.1 * weight;
    if (a.help === 'unknown') return 0.05 * weight;
    return 0; // major/solution help is acquisition, not independent evidence
  }
  if (a.outcome === 'not_solved')
    return a.evidence === 'retention' ? -0.15 : a.evidence === 'near_transfer' ? -0.1 : 0;
  return a.evidence === 'retention' ? -0.1 : a.evidence === 'near_transfer' ? -0.05 : 0; // stopped
}
function rationale(a: AttemptRecord): string {
  const what =
    a.outcome === 'solved'
      ? a.help === 'none'
        ? 'solved independently'
        : a.help === 'small'
          ? 'solved with a small hint'
          : 'solved with unrecorded help'
      : a.outcome === 'not_solved'
        ? 'did not solve'
        : 'stopped early';
  return `Auto: ${what} · ${a.evidence} evidence`;
}
export function applyAutoScore(db: Db, a: AttemptRecord, clock: () => Date): ScoreDecision[] {
  if (readSettings(db).autoScore === false) return [];
  const problem = getProblem(db, a.problemId);
  const delta = autoScoreDelta(a, problem.difficulty);
  if (!delta) return [];
  // Topics are the curriculum grouping (NeetCode's categories); tags are the
  // user's own labels for what a question involves. Scoring follows the
  // category so relabelling a question never moves a score. Questions outside
  // the verified lists fall back to a tag whose name IS a tracked topic.
  const category = neetcodeCategory(problem);
  const names = new Set<string>();
  if (category) names.add(category.toLowerCase());
  else
    for (const t of problemTags(db, a.problemId).filter((t) => !t.archived))
      names.add(t.name.toLowerCase());
  const cap = a.evidence === 'unseen' && a.outcome === 'solved' && a.help === 'none' ? 5 : 3;
  const decisions: ScoreDecision[] = [];
  for (const t of topicRows(db, 'WHERE score IS NOT NULL').filter((t) =>
    names.has(t.name.toLowerCase()),
  )) {
    // The cap withholds further increases; it must never pull an existing
    // higher score down, so a solve can only ever raise or leave a score.
    const next =
      delta > 0
        ? t.score! >= cap
          ? t.score!
          : Math.round(Math.min(cap, t.score! + delta) * 100) / 100
        : Math.round(Math.max(1, t.score! + delta) * 100) / 100;
    if (next === t.score) continue;
    decisions.push(
      recordDecision(db, clock, a, t, {
        newScore: next,
        rationale: rationale(a),
        evidence: a.evidence,
        provisional: a.evidence !== 'unseen',
      }),
    );
  }
  return decisions;
}
