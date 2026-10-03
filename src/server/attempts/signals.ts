// Extra results the learner records after an attempt: whether LeetCode accepted the
// first submission, and whether it felt too easy or too hard. Kept apart from the
// attempt row so the attempt's version and closeout flow are untouched.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Db, maybe, run } from '../db/db.js';
import { conflict } from '../db/errors.js';

export interface AttemptSignals {
  acceptedFirstTry: boolean | null;
  difficulty: 'too_easy' | 'too_hard' | null;
}

export function readSignals(db: Db, attemptId: string): AttemptSignals {
  const row = maybe<{ acceptedFirstTry: number | null; difficulty: AttemptSignals['difficulty'] }>(
    db,
    'SELECT acceptedFirstTry, difficulty FROM attempt_signals WHERE attemptId = ?',
    attemptId,
  );
  return {
    acceptedFirstTry: row?.acceptedFirstTry == null ? null : !!row.acceptedFirstTry,
    difficulty: row?.difficulty ?? null,
  };
}

export function registerAttemptSignals(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get<{ Params: { id: string } }>('/api/attempts/:id/signals', (req) =>
    readSignals(db, req.params.id),
  );
  app.patch<{ Params: { id: string } }>('/api/attempts/:id/signals', (req) => {
    const body = z
      .object({
        acceptedFirstTry: z.boolean().nullable().optional(),
        difficulty: z.enum(['too_easy', 'too_hard']).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    if (!maybe(db, "SELECT 1 FROM attempts WHERE id = ? AND status = 'completed'", req.params.id))
      throw conflict('Only finished attempts take these results');
    const next = { ...readSignals(db, req.params.id), ...body };
    run(
      db,
      `INSERT OR REPLACE INTO attempt_signals (attemptId, acceptedFirstTry, difficulty, recordedAt)
       VALUES (?, ?, ?, ?)`,
      req.params.id,
      next.acceptedFirstTry === null ? null : next.acceptedFirstTry ? 1 : 0,
      next.difficulty,
      clock().toISOString(),
    );
    return readSignals(db, req.params.id);
  });
}
