import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Db, many, maybe, one, run } from '../db/db.js';
import { idempotent } from '../db/idempotency.js';
import { conflict } from '../db/errors.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { confirmedGoalChange } from '../../shared/learning-goals.js';

type Goal = {
  id: string;
  text: string;
  state: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  sourceConversation: string;
};

export function registerLearningGoals(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/learning-goals', (req) => {
    assertMetadataVisible(db);
    const { state } = z
      .object({ state: z.enum(['active', 'completed', 'abandoned', 'all']).default('active') })
      .strict()
      .parse(req.query);
    const rows = many<Goal>(
      db,
      `SELECT * FROM learning_goals WHERE (? = 'all' OR state = ?)
      ORDER BY updatedAt DESC, id LIMIT 21`,
      state,
      state,
    );
    return { goals: rows.slice(0, 20), hasMore: rows.length > 20 };
  });
  // Scoped tutor credentials cannot enter this route. Only the host's explicit
  // confirmation flow uses the full local credential to commit the change.
  app.post('/api/learning-goals', (req) => {
    assertMetadataVisible(db);
    const body = confirmedGoalChange.parse(req.body);
    return idempotent(db, 'learning-goal', req.headers['idempotency-key'], body, () => {
      const now = clock().toISOString(),
        change = body.change;
      if (change.action === 'create') {
        const existing = maybe<Goal>(
          db,
          "SELECT * FROM learning_goals WHERE state = 'active' AND lower(trim(text)) = lower(trim(?))",
          change.text,
        );
        if (existing) return existing;
        const id = randomUUID();
        run(
          db,
          "INSERT INTO learning_goals VALUES (?, ?, 'active', 0, ?, ?, ?)",
          id,
          change.text,
          now,
          now,
          body.sourceConversation,
        );
        return one<Goal>(db, 'SELECT * FROM learning_goals WHERE id = ?', id);
      }
      const goal = one<Goal>(db, 'SELECT * FROM learning_goals WHERE id = ?', change.goalId);
      if (goal.version !== change.expectedVersion)
        throw conflict('Goal changed; read it again before confirming');
      if (goal.text !== change.text)
        throw conflict('Goal text does not match the change shown for confirmation');
      if (
        change.state === 'active' &&
        maybe(
          db,
          "SELECT id FROM learning_goals WHERE state = 'active' AND lower(trim(text)) = lower(trim(?)) AND id != ?",
          goal.text,
          goal.id,
        )
      )
        throw conflict('An equivalent active goal already exists');
      run(
        db,
        'UPDATE learning_goals SET state = ?, version = version + 1, updatedAt = ? WHERE id = ?',
        change.state,
        now,
        goal.id,
      );
      return one<Goal>(db, 'SELECT * FROM learning_goals WHERE id = ?', goal.id);
    });
  });
}
