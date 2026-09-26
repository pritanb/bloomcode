import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recommendationSchema } from '../../shared/recommendations.js';
import { recommendationContext } from '../plans/recommendations.js';
import type { Db } from './storage.js';
import { settings } from '../db/schema.js';
import { ApiError } from '../db/errors.js';
import { Store } from '../db/store.js';

const validTimezone = (v: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

const settingsUpdate = z
  .object({
    autoScore: z.boolean().optional(),
    recommendations: recommendationSchema.optional(),
    timezone: z.string().refine(validTimezone, 'Invalid timezone').optional(),
    questionsPerDay: z.number().int().min(1).max(20).optional(),
    budgetMinutes: z.number().int().min(5).max(240).optional(),
    primaryCount: z.number().int().min(1).max(10).optional(),
    optionalCount: z.number().int().min(0).max(10).optional(),
  })
  .strict();

const readSettings = (db: Db) => db.orm.select().from(settings).get()!.data;

/** The local app's study day follows the computer's timezone. */
export function syncSystemTimezone(db: Db) {
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = db.orm.select().from(settings).get();
  if (system && current && current.data.timezone !== system)
    db.orm
      .update(settings)
      .set({ data: { ...current.data, timezone: system } })
      .run();
}

export function registerSettings(app: FastifyInstance, db: Db, store: Store) {
  app.get('/api/settings', () => readSettings(db));
  app.patch('/api/settings', (req) => {
    const update = settingsUpdate.parse(req.body);
    const rec = update.recommendations;
    if (rec?.listId && !store.all<{ id: string }>('lists').some((l) => l.id === rec.listId))
      throw new ApiError(400, 'VALIDATION', 'Choose an available list');
    if (
      rec?.startTopic &&
      !recommendationContext(store, rec).options.topics.some((t) => t.name === rec.startTopic)
    )
      throw new ApiError(400, 'VALIDATION', 'Choose an available starting topic for this list');
    const data = { ...readSettings(db), ...update };
    db.orm.update(settings).set({ data }).run();
    return data;
  });
}
