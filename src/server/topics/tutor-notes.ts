import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Db, many, maybe, one, run } from '../db/db.js';
import { idempotent } from '../db/idempotency.js';
import { ApiError, conflict } from '../db/errors.js';
import { assertMetadataVisible, problemViews } from '../catalogue/problem-model.js';
import { readSettings } from '../db/settings.js';
import { studyDate } from '../attempts/attempt-model.js';
import { findPlan } from '../plans/plan-model.js';
import { neetcodeCategories } from './neetcode-category.js';
import { topicOf } from './training-levels.js';
import { confirmedNoteChange, notesInBudget, type TutorNote } from '../../shared/tutor-notes.js';

const COLUMNS = 'id, text, topic, version, createdAt, updatedAt';

/** Active lessons, general first, then by topic in ladder order, oldest first within each. */
export function activeNotes(db: Db): TutorNote[] {
  return many<TutorNote>(
    db,
    `SELECT ${COLUMNS} FROM tutor_notes WHERE state = 'active' ORDER BY createdAt, id`,
  ).sort(
    (a, b) =>
      (a.topic === null ? -1 : neetcodeCategories.indexOf(a.topic)) -
      (b.topic === null ? -1 : neetcodeCategories.indexOf(b.topic)),
  );
}

/** The topics of today's planned problems: what chat is most likely to discuss. */
function todayTopics(db: Db, clock: () => Date) {
  const settings = readSettings(db);
  const plan = findPlan(db, studyDate(clock(), settings.timezone), settings.timezone);
  if (!plan) return [];
  return problemViews(
    db,
    'WHERE p.id IN (SELECT problemId FROM plan_items WHERE planId = ?)',
    plan.id,
  ).map(topicOf);
}

const read = (db: Db, id: string) =>
  one<TutorNote & { state: string }>(
    db,
    `SELECT ${COLUMNS}, state FROM tutor_notes WHERE id = ?`,
    id,
  );

function checkTopic(topic: string | null) {
  if (topic !== null && !neetcodeCategories.includes(topic))
    throw new ApiError(
      400,
      'VALIDATION',
      `Unknown topic. Use one of: ${neetcodeCategories.join(', ')}`,
    );
}

function retire(db: Db, id: string, now: string) {
  run(
    db,
    "UPDATE tutor_notes SET state = 'retired', version = version + 1, updatedAt = ? WHERE id = ?",
    now,
    id,
  );
}

export function registerTutorNotes(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/tutor-notes', (req) => {
    assertMetadataVisible(db);
    const { topic, all } = z
      .object({ topic: z.string().max(60).optional(), all: z.literal('true').optional() })
      .strict()
      .parse(req.query);
    const notes = activeNotes(db);
    if (all) return { notes, total: notes.length, hasMore: false };
    if (topic !== undefined) {
      const shown = notes.filter((n) => n.topic === topic);
      return { notes: shown, total: notes.length, hasMore: shown.length < notes.length };
    }
    // Once lessons outgrow the prompt budget, today's topics decide what to show.
    return notesInBudget(notes, () => todayTopics(db, clock));
  });
  // Scoped tutor credentials cannot enter this route. Only the host's explicit
  // confirmation flow uses the full local credential to commit the change.
  app.post('/api/tutor-notes', (req) => {
    assertMetadataVisible(db);
    const body = confirmedNoteChange.parse(req.body);
    return idempotent(db, 'tutor-note', req.headers['idempotency-key'], body, () => {
      const now = clock().toISOString(),
        change = body.change;
      if (change.action === 'create') {
        checkTopic(change.topic);
        const existing = maybe<{ id: string }>(
          db,
          "SELECT id FROM tutor_notes WHERE state = 'active' AND lower(trim(text)) = lower(trim(?))",
          change.text,
        );
        if (existing) return read(db, existing.id);
        const id = randomUUID();
        run(
          db,
          "INSERT INTO tutor_notes VALUES (?, ?, ?, 'active', 0, ?, ?, ?)",
          id,
          change.text,
          change.topic,
          now,
          now,
          body.sourceConversation,
        );
        return read(db, id);
      }
      const note = read(db, change.noteId);
      const shownText = change.action === 'update' ? change.oldText : change.text;
      if (note.state !== 'active' || note.version !== change.expectedVersion)
        throw conflict('Lesson changed; read it again before confirming');
      if (note.text !== shownText)
        throw conflict('Lesson text does not match the change shown for confirmation');
      if (change.action === 'retire') {
        retire(db, note.id, now);
        return read(db, note.id);
      }
      checkTopic(change.topic);
      if (
        maybe(
          db,
          "SELECT id FROM tutor_notes WHERE state = 'active' AND lower(trim(text)) = lower(trim(?)) AND id != ?",
          change.text,
          note.id,
        )
      )
        throw conflict('An equivalent lesson already exists');
      run(
        db,
        `UPDATE tutor_notes SET text = ?, topic = ?, version = version + 1, updatedAt = ?,
        sourceConversation = ? WHERE id = ?`,
        change.text,
        change.topic,
        now,
        body.sourceConversation,
        note.id,
      );
      return read(db, note.id);
    });
  });
  // Settings' Forget button. The tutor credential cannot reach any POST but evidence search.
  app.post<{ Params: { id: string } }>('/api/tutor-notes/:id/forget', (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const note = read(db, z.string().uuid().parse(req.params.id));
    if (note.state === 'active') retire(db, note.id, clock().toISOString());
    return { ok: true };
  });
}
