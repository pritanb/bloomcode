import type { FastifyInstance } from 'fastify';
import { type Db, openDb } from '../db/db.js';
import { syncSystemTimezone } from './settings.js';

/** Opens the database, closed with the app. */
export function openStorage(
  app: FastifyInstance,
  { dbPath, followSystemTimezone }: { dbPath: string; followSystemTimezone?: boolean },
): Db {
  const db = openDb(dbPath);
  app.addHook('onClose', async () => {
    db.close();
  });
  if (followSystemTimezone) syncSystemTimezone(db);
  return db;
}
