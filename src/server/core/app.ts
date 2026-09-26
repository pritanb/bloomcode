import Fastify from 'fastify';
import type { Embed } from '../insights/embeddings.js';
import { tokenFor } from './auth.js';
import { registerHttp } from './http.js';
import { openStorage } from './storage.js';
import { registerStudyRoutes } from './study-routes.js';
import { registerTutorFeatures } from './tutor-features.js';

export interface AppOptions {
  dbPath: string;
  embed?: Embed;
  demo?: boolean;
  token?: string;
  serveStatic?: boolean | string;
  clock?: () => Date;
  /** Tests leave this off so a pinned settings.timezone stays deterministic. */
  followSystemTimezone?: boolean;
}

export async function createApp(options: AppOptions) {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false });
  const clock = options.clock ?? (() => new Date());
  const token = options.token ?? tokenFor(options.dbPath);

  // 1. Open the database and bring stored data up to date.
  const { db, store } = openStorage(app, options);
  // 2. Local-only access, error format, web app and /health.
  await registerHttp(app, { token, clock, serveStatic: options.serveStatic });
  // 3. Study data: problems, attempts, scores, plans, backups.
  registerStudyRoutes(app, { db, store, clock, dbPath: options.dbPath, demo: options.demo });
  // 4. The Codex tutor and the insights it builds.
  registerTutorFeatures(app, { store, clock, token, dbPath: options.dbPath, embed: options.embed });

  return app;
}
