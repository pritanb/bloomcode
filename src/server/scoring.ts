import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Topic, ScoreDecision } from '../shared/contracts.js';
import { Store } from './store.js';
import { date } from './catalogue.js';
import { type AttemptRecord, attemptView, checkVersion, version } from './attempts.js';
import { ApiError, conflict } from './errors.js';
import { idempotent } from './idempotency.js';
import { score } from './import.js';
import { recommendation, updateTarget } from './closeout.js';
export function registerScoring(app: FastifyInstance, s: Store, clock: () => Date) {
  app.post<{ Params: { id: string } }>('/api/attempts/:id/reviews', (req) => {
    const b = z
      .object({
        version,
        feedback: z.string().min(1).max(100000),
        decisions: z
          .array(
            z
              .object({
                topicId: z.string(),
                expectedVersion: version,
                oldScore: score,
                newScore: score,
                rationale: z.string().min(1).max(20000),
                evidence: z.enum(['retention', 'near_transfer', 'unseen', 'mock']),
              })
              .strict(),
          )
          .max(100)
          .optional()
          .default([]),
        followUp: z
          .object({ date: date.nullable(), action: z.enum(['recommended', 'manual', 'none']) })
          .strict()
          .optional(),
      })
      .strict()
      .parse(req.body);
    return idempotent(s, `review:${req.params.id}`, req.headers['idempotency-key'], b, () => {
      const a = s.get<AttemptRecord>('attempts', req.params.id);
      checkVersion(a, b.version);
      if (a.status !== 'completed') throw conflict('Finish the attempt before saving a review');
      if (new Set(b.decisions.map((d) => d.topicId)).size !== b.decisions.length)
        throw new ApiError(400, 'VALIDATION', 'Each topic may occur once per review');
      const decisions: ScoreDecision[] = [];
      for (const d of b.decisions) {
        const t = s.get<Topic>('topics', d.topicId);
        checkVersion(t, d.expectedVersion);
        if (t.score !== d.oldScore)
          throw conflict('Old score does not match the current topic score');
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
    });
  });
}
