import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/db.js';
import { registerSettings } from './settings.js';
import { registerSetup } from '../catalogue/setup.js';
import { registerCatalogue } from '../catalogue/catalogue.js';
import { registerImport } from '../catalogue/import.js';
import { registerAttempts } from '../attempts/attempts.js';
import { registerTopics } from '../topics/topics.js';
import { registerLearningGoals } from '../topics/learning-goals.js';
import { registerStudyTools } from '../topics/study-tools.js';
import { registerScoring } from '../scoring/scoring.js';
import { registerPlans } from '../plans/plans.js';
import { registerTransfer } from '../transfer/transfer.js';

/** Routes for the study data itself: problems, attempts, scores, plans, backups. */
export function registerStudyRoutes(
  app: FastifyInstance,
  {
    db,
    clock,
    dbPath,
    demo,
    dailyBackup,
  }: {
    db: Db;
    clock: () => Date;
    dbPath: string;
    demo?: boolean;
    dailyBackup?: boolean;
  },
) {
  registerSettings(app, db);
  registerSetup(app, db, clock, demo);
  registerCatalogue(app, db);
  registerImport(app, db, clock);
  registerAttempts(app, db, clock);
  registerTopics(app, db);
  registerLearningGoals(app, db, clock);
  registerScoring(app, db, clock);
  registerPlans(app, db, clock);
  registerStudyTools(app, db, clock);
  registerTransfer(app, db, clock, dbPath, dailyBackup);
}
