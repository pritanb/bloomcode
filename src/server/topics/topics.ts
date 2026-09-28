import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { attempts, attemptView, NEWEST } from '../attempts/attempt-model.js';
import { problemViews, assertMetadataVisible } from '../catalogue/problem-model.js';
import { decisions, getTopic, topics, topicRows, topicView } from './topic-model.js';
export function registerTopics(app: FastifyInstance, db: Db) {
  app.get('/api/topics', () => topics(db));
  app.get('/api/topics/scores', (req) => {
    assertMetadataVisible(db);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .strict()
      .parse(req.query);
    const rows = topicRows(db).sort(
      (a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.id.localeCompare(b.id),
    );
    return {
      total: rows.length,
      unscoredCount: rows.filter((t) => t.score === null).length,
      hasMore: rows.length > limit,
      topics: rows.slice(0, limit).map(({ id, name, score, provisional, lastReviewed }) => ({
        id,
        name,
        score,
        provisional: !!provisional,
        lastReviewed,
      })),
    };
  });
  // Score-only history is safe during mixed practice; no problem metadata,
  // evidence, notes or attempt identifiers are returned by this route.
  app.get<{ Params: { id: string } }>('/api/topics/:id/history', (req) => {
    const topic = getTopic(db, req.params.id);
    return {
      topic: { id: topic.id, name: topic.name, score: topic.score },
      decisions: decisions(db, 'WHERE d.topicId = ? ORDER BY d.rowid DESC', topic.id).map((d) => ({
        id: d.id,
        date: d.date,
        recordedAt: d.recordedAt,
        oldScore: d.oldScore,
        newScore: d.newScore,
      })),
    };
  });
  app.get<{ Params: { id: string } }>('/api/topics/:id', (req) => {
    assertMetadataVisible(db);
    const topic = topicView(db, getTopic(db, req.params.id)),
      q = z
        .object({
          evidence: z.string().optional(),
          help: z.string().optional(),
          difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
        })
        .strict()
        .parse(req.query);
    const where = ['a.id IN (SELECT attemptId FROM attempt_topics WHERE topicId = ?)'],
      params = [topic.id];
    for (const [column, value] of [
      ['a.evidence', q.evidence],
      ['a.help', q.help],
      ['p.difficulty', q.difficulty],
    ] as const)
      if (value) {
        where.push(`${column} = ?`);
        params.push(value);
      }
    const practised = attempts(db, `WHERE ${where.join(' AND ')} ${NEWEST}`, ...params).map(
      attemptView,
    );
    const known = practised
        .filter((a) => a.outcome === 'solved' && a.activeSeconds !== null)
        .map((a) => a.activeSeconds!)
        .sort((a, b) => a - b),
      mid = Math.floor(known.length / 2),
      problemIds = [...new Set(practised.map((a) => a.problemId))];
    return {
      topic,
      decisions: decisions(db, 'WHERE d.topicId = ? ORDER BY d.rowid DESC', topic.id),
      attempts: practised,
      problems: problemViews(
        db,
        `WHERE p.id IN (${problemIds.map(() => '?').join(', ')})`,
        ...problemIds,
      ),
      stats: {
        attemptCount: practised.length,
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
