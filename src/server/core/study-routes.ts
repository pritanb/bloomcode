import type { FastifyInstance } from 'fastify';
import type { Store } from '../db/store.js';
import type { Db } from './storage.js';
import { registerSettings } from './settings.js';
import { registerSetup } from '../catalogue/setup.js';
import { registerCatalogue } from '../catalogue/catalogue.js';
import { registerImport } from '../catalogue/import.js';
import { registerAttempts } from '../attempts/attempts.js';
import { registerTopics } from '../topics/topics.js';
import { registerStudyTools } from '../topics/study-tools.js';
import { registerScoring } from '../scoring/scoring.js';
import { registerPlans } from '../plans/plans.js';
import { registerTransfer } from '../transfer/transfer.js';

/** Routes for the study data itself: problems, attempts, scores, plans, backups. */
export function registerStudyRoutes(
  app: FastifyInstance,
  {
    db,
    store,
    clock,
    dbPath,
    demo,
  }: { db: Db; store: Store; clock: () => Date; dbPath: string; demo?: boolean },
) {
  registerSettings(app, db, store);
  registerSetup(app, store, clock, demo);
  registerCatalogue(app, store, clock);
  registerImport(app, store, clock);
  registerAttempts(app, store, clock);
  registerTopics(app, store);
  registerScoring(app, store, clock);
  registerPlans(app, store, clock);
  registerStudyTools(app, store, clock);
  registerTransfer(app, store, clock, dbPath);
}
