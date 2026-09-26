// Saving a tutor note on a finished attempt, optionally moving topic scores.
// Shared by the review route (tutor chat via MCP) and the app's Codex worker.
import { randomUUID } from 'node:crypto';
import type { Topic, ScoreDecision } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
import { type AttemptRecord, attemptView, checkVersion } from '../attempts/attempt-model.js';
import { ApiError, conflict } from '../db/errors.js';
import { recommendation, updateTarget } from '../attempts/review-schedule.js';
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
/** Call inside a transaction. */
export function saveReview(s: Store, clock: () => Date, attemptId: string, b: ReviewInput) {
  const a = s.get<AttemptRecord>('attempts', attemptId);
  checkVersion(a, b.version);
  if (a.status !== 'completed') throw conflict('Finish the attempt before saving a review');
  if (new Set(b.decisions.map((d) => d.topicId)).size !== b.decisions.length)
    throw new ApiError(400, 'VALIDATION', 'Each topic may occur once per review');
  const decisions: ScoreDecision[] = [];
  for (const d of b.decisions) {
    const t = s.get<Topic>('topics', d.topicId);
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
    const decision: ScoreDecision = {
      id: randomUUID(),
      topicId: t.id,
      topicName: t.name,
      attemptId: a.id,
      oldScore: d.oldScore,
      newScore: d.newScore,
      rationale: d.rationale,
      evidence: d.evidence,
      date: a.studyDate,
      recordedAt: clock().toISOString(),
    };
    const previous = s
      .all<ScoreDecision>('score_decisions')
      .filter((x) => x.attemptId === a.id && x.topicId === t.id)
      .at(-1);
    s.put('score_decisions', { ...decision, supersedesId: previous?.id ?? null });
    s.put('topics', {
      ...t,
      score: d.newScore,
      version: t.version + 1,
      lastReviewed: a.studyDate,
      provisional:
        d.newScore === d.oldScore ? t.provisional : !['unseen', 'mock'].includes(d.evidence),
      lastMovement: null,
    });
    s.put('attempt_topics', { id: `${a.id}:${t.id}`, attemptId: a.id, topicId: t.id });
    decisions.push(decision);
  }
  a.feedback = b.feedback;
  a.reviewedAt = clock().toISOString();
  a.version++;
  if (b.followUp) {
    const r = recommendation(a);
    a.nextReviewDate = updateTarget(
      s,
      a.problemId,
      b.followUp.date,
      r.stage,
      b.followUp,
    ).effectiveDate;
  }
  s.put('attempts', a);
  s.put('audit_events', {
    id: randomUUID(),
    action: 'review_attempt',
    attemptId: a.id,
    decisionIds: decisions.map((d) => d.id),
    recordedAt: clock().toISOString(),
  });
  return { attempt: attemptView(a), decisions };
}
