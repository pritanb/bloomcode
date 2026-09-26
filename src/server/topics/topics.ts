import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Topic, ScoreDecision, Problem } from '../../shared/contracts.js';
import { Store } from '../db/store.js';
import { newestAttempt, attemptView, type AttemptRecord } from '../attempts/attempt-model.js';
import { problemView, assertMetadataVisible } from '../catalogue/problem-model.js';
import { type AttemptTopic, decisionView, topicView } from './topic-model.js';
export function registerTopics(app: FastifyInstance, s: Store) {
  app.get('/api/topics', () => s.all<Topic>('topics').map((t) => topicView(s, t)));
  // Score-only history is safe during mixed practice; no problem metadata,
  // evidence, notes or attempt identifiers are returned by this route.
  app.get<{ Params: { id: string } }>('/api/topics/:id/history', (req) => {
    const topic = s.get<Topic>('topics', req.params.id);
    return {
      topic: { id: topic.id, name: topic.name, score: topic.score },
      decisions: s
        .all<ScoreDecision>('score_decisions')
        .filter((d) => d.topicId === topic.id)
        .reverse()
        .map((d) => ({
          id: d.id,
          date: d.date,
          recordedAt: d.recordedAt,
          oldScore: d.oldScore,
          newScore: d.newScore,
        })),
    };
  });
  app.get<{ Params: { id: string } }>('/api/topics/:id', (req) => {
    assertMetadataVisible(s);
    const topic = topicView(s, s.get<Topic>('topics', req.params.id)),
      q = z
        .object({
          evidence: z.string().optional(),
          help: z.string().optional(),
          difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
        })
        .strict()
        .parse(req.query);
    const ids = new Set(
      s
        .all<AttemptTopic>('attempt_topics')
        .filter((l) => l.topicId === topic.id)
        .map((l) => l.attemptId),
    );
    const attempts = s
      .all<AttemptRecord>('attempts')
      .filter(
        (a) =>
          ids.has(a.id) &&
          (!q.evidence || a.evidence === q.evidence) &&
          (!q.help || a.help === q.help) &&
          (!q.difficulty || a.problem.difficulty === q.difficulty),
      )
      .sort(newestAttempt)
      .map(attemptView);
    const problemIds = new Set(attempts.map((a) => a.problemId)),
      known = attempts
        .filter((a) => a.outcome === 'solved' && a.activeSeconds !== null)
        .map((a) => a.activeSeconds!)
        .sort((a, b) => a - b),
      mid = Math.floor(known.length / 2);
    return {
      topic,
      decisions: s
        .all<ScoreDecision>('score_decisions')
        .filter((d) => d.topicId === topic.id)
        .reverse()
        .map(decisionView),
      attempts,
      problems: s
        .all<Problem>('problems')
        .filter((p) => problemIds.has(p.id))
        .map((p) => problemView(s, p)),
      stats: {
        attemptCount: attempts.length,
        knownTimeCount: known.length,
        medianSeconds: known.length
          ? known.length % 2
            ? known[mid]!
            : (known[mid - 1]! + known[mid]!) / 2
          : null,
      },
    };
  });
}
