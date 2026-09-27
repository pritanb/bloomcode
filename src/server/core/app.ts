import Fastify from 'fastify';
import type { Embed } from '../insights/embeddings.js';
import { tokenFor, tutorTokenFor } from './auth.js';
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
  /** Back up at startup when the last backup is over a day old. The real app sets it; tests don't. */
  dailyBackup?: boolean;
}

export async function createApp(options: AppOptions) {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024, logger: false });
  const clock = options.clock ?? (() => new Date());
  const token = options.token ?? tokenFor(options.dbPath);
  const tutorToken = tutorTokenFor(options.dbPath);

  // 1. Open the database and bring stored data up to date.
  const db = openStorage(app, options);
  // 2. Local-only access, error format, web app and /health.
  await registerHttp(app, { token, tutorToken, clock, serveStatic: options.serveStatic });
  // 3. Study data: problems, attempts, scores, plans, backups.
  registerStudyRoutes(app, {
    db,
    clock,
    dbPath: options.dbPath,
    demo: options.demo,
    dailyBackup: options.dailyBackup,
  });
  // 4. The Codex tutor and the insights it builds.
  registerTutorFeatures(app, {
    db,
    clock,
    token,
    tutorToken,
    dbPath: options.dbPath,
    embed: options.embed,
  });

  return app;
}
