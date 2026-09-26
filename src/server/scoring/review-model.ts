// Saving a tutor note on a finished attempt, optionally moving topic scores.
// Shared by the review route (tutor chat via MCP) and the app's Codex worker.
import { randomUUID } from 'node:crypto';
import type { ScoreDecision } from '../../shared/contracts.js';
import { type Db, insert, maybe, run, update } from '../db/db.js';
import {
  type AttemptRecord,
  attemptView,
  checkVersion,
  getAttempt,
} from '../attempts/attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import { recommendation, updateTarget } from '../attempts/review-schedule.js';
import { getTopic, type TopicRow } from '../topics/topic-model.js';
export interface ReviewInput {
  version: number;
  feedback: string;
  decisions: {
    topicId: string;
    expectedVersion: number;
    oldScore: number;
    newScore: number;
    rationale: string;
    evidence: 'retention' | 'near_transfer' | 'unseen' | 'mock';
  }[];
  followUp?: { date: string | null; action: 'recommended' | 'manual' | 'none' };
}
/**
 * Move a topic's score because of an attempt. A later decision for the same attempt and
 * topic supersedes the earlier one; the attempt then counts toward the topic.
 */
export function recordDecision(
  db: Db,
  clock: () => Date,
  a: AttemptRecord,
  t: TopicRow,
  change: { newScore: number; rationale: string; evidence: string; provisional: boolean },
): ScoreDecision {
  const decision: ScoreDecision = {
    id: randomUUID(),
    topicId: t.id,
    topicName: t.name,
    attemptId: a.id,
    oldScore: t.score!,
    newScore: change.newScore,
    rationale: change.rationale,
    evidence: change.evidence,
    date: a.studyDate,
    recordedAt: clock().toISOString(),
  };
  const previous = maybe<{ id: string }>(
    db,
    'SELECT id FROM score_decisions WHERE attemptId = ? AND topicId = ? ORDER BY rowid DESC LIMIT 1',
    a.id,
    t.id,
  );
  const { topicName: _name, ...stored } = decision;
  insert(db, 'score_decisions', { ...stored, supersedesId: previous?.id ?? null });
  update(db, 'topics', t.id, {
    score: change.newScore,
    version: t.version + 1,
    lastReviewed: a.studyDate,
    provisional: change.provisional,
  });
  run(db, 'INSERT OR IGNORE INTO attempt_topics (attemptId, topicId) VALUES (?, ?)', a.id, t.id);
  return decision;
}
/** Call inside a transaction. */
export function saveReview(db: Db, clock: () => Date, attemptId: string, b: ReviewInput) {
  const a = getAttempt(db, attemptId);
  checkVersion(a, b.version);
  if (a.status !== 'completed') throw conflict('Finish the attempt before saving a review');
  if (new Set(b.decisions.map((d) => d.topicId)).size !== b.decisions.length)
    throw new ApiError(400, 'VALIDATION', 'Each topic may occur once per review');
  const decisions: ScoreDecision[] = [];
  for (const d of b.decisions) {
    const t = getTopic(db, d.topicId);
    checkVersion(t, d.expectedVersion);
    if (t.score !== d.oldScore) throw conflict('Old score does not match the current topic score');
    if (
      (a.evidence === 'retention' && d.evidence !== 'retention') ||
      (['unseen', 'mock'].includes(d.evidence) && a.evidence !== 'unseen')
    )
      throw new ApiError(
        400,
        'EVIDENCE',
        'Known or targeted practice cannot be labelled unseen/mock',
      );
    if (
      d.newScore > d.oldScore &&
      d.newScore > 3 &&
      (!['unseen', 'mock'].includes(d.evidence) || a.outcome !== 'solved' || a.help !== 'none')
    )
      throw new ApiError(
        400,
        'EVIDENCE',
        'An increase above 3 requires independent unseen or mock evidence',
      );
    decisions.push(
      recordDecision(db, clock, a, t, {
        newScore: d.newScore,
        rationale: d.rationale,
        evidence: d.evidence,
        provisional:
          d.newScore === d.oldScore ? !!t.provisional : !['unseen', 'mock'].includes(d.evidence),
      }),
    );
  }
  const fields: Partial<AttemptRecord> = {
    feedback: b.feedback,
    reviewedAt: clock().toISOString(),
    version: a.version + 1,
  };
  if (b.followUp) {
    const r = recommendation(a);
    fields.nextReviewDate = updateTarget(
      db,
      a.problemId,
      b.followUp.date,
      r.stage,
      b.followUp,
    ).effectiveDate;
  }
  update(db, 'attempts', a.id, fields);
  return { attempt: attemptView(getAttempt(db, a.id)), decisions };
}
