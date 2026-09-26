import type { FastifyInstance } from 'fastify';
import { openDb } from '../db/db.js';
import { Store } from '../db/store.js';
import { syncSystemTimezone } from './settings.js';

export type Db = ReturnType<typeof openDb>;

/**
 * Opens the database (closed with the app) and brings stored data up to date
 * before any route can read it.
 */
export function openStorage(
  app: FastifyInstance,
  { dbPath, followSystemTimezone }: { dbPath: string; followSystemTimezone?: boolean },
) {
  const db = openDb(dbPath);
  app.addHook('onClose', async () => {
    db.sqlite.close();
  });
  if (followSystemTimezone) syncSystemTimezone(db);
  const store = new Store(db.sqlite);
  // Re-saving a tag without a hue lets Store.put assign one.
  store.transaction(() => {
    for (const tag of store.all<{ id: string; hue?: number }>('tags'))
      if (tag.hue === undefined) store.put('tags', tag);
  });
  return { db, store };
}
