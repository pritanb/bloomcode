import type { FastifyInstance } from 'fastify';
import { type Db, many, openDb, transaction, update } from '../db/db.js';
import { newTagHue } from '../db/tag-colour.js';
import { syncSystemTimezone } from './settings.js';

/**
 * Opens the database (closed with the app) and brings stored data up to date
 * before any route can read it.
 */
export function openStorage(
  app: FastifyInstance,
  { dbPath, followSystemTimezone }: { dbPath: string; followSystemTimezone?: boolean },
): Db {
  const db = openDb(dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });
  if (followSystemTimezone) syncSystemTimezone(db);
  // Tags from before colours existed get one now.
  transaction(db, () => {
    for (const { id } of many<{ id: string }>(db, 'SELECT id FROM tags WHERE hue IS NULL'))
      update(db, 'tags', id, {
        hue: newTagHue(
          many<{ hue: number }>(db, 'SELECT hue FROM tags WHERE hue IS NOT NULL').map((t) => t.hue),
        ),
      });
  });
  return db;
}
