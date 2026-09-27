import type { FastifyInstance } from 'fastify';
import { type Db, one, run } from '../db/db.js';
import { idempotent } from '../db/idempotency.js';
import { conflict } from '../db/errors.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { confirmedPreferenceChange } from '../../shared/tutor-preferences.js';

type Preferences = {
  explanationDepth: string;
  hintStyle: string;
  version: number;
  updatedAt: string | null;
  sourceConversation: string | null;
};
const read = (db: Db) =>
  one<Preferences>(
    db,
    'SELECT explanationDepth, hintStyle, version, updatedAt, sourceConversation FROM tutor_preferences WHERE id = 1',
  );

export function registerTutorPreferences(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/tutor-preferences', () => {
    assertMetadataVisible(db);
    return read(db);
  });
  app.post('/api/tutor-preferences', (req) => {
    assertMetadataVisible(db);
    const body = confirmedPreferenceChange.parse(req.body);
    return idempotent(db, 'tutor-preferences', req.headers['idempotency-key'], body, () => {
      const current = read(db),
        change = body.change;
      if (current.version !== change.expectedVersion)
        throw conflict('Preferences changed; read them again before confirming');
      run(
        db,
        `UPDATE tutor_preferences SET explanationDepth = ?, hintStyle = ?,
        version = version + 1, updatedAt = ?, sourceConversation = ? WHERE id = 1`,
        change.explanationDepth,
        change.hintStyle,
        clock().toISOString(),
        body.sourceConversation,
      );
      return read(db);
    });
  });
}
