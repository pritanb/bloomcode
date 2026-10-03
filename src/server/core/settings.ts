import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recommendationSchema } from '../../shared/recommendations.js';
import type { Db } from '../db/db.js';
import { readSettings, writeSettings } from '../db/settings.js';

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
    primaryCount: z.number().int().min(1).max(10).optional(),
    optionalCount: z.number().int().min(0).max(10).optional(),
  })
  .strict();

/** The local app's study day follows the computer's timezone. */
export function syncSystemTimezone(db: Db) {
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (system && readSettings(db).timezone !== system) writeSettings(db, { timezone: system });
}

export function registerSettings(app: FastifyInstance, db: Db) {
  app.get('/api/settings', () => readSettings(db));
  app.patch('/api/settings', (req) => {
    const update = settingsUpdate.parse(req.body);
    writeSettings(db, update);
    return readSettings(db);
  });
}
