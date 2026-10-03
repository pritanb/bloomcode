import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/db.js';
import { registerSettings } from './settings.js';
import { registerSetup } from '../catalogue/setup.js';
import { registerCatalogue } from '../catalogue/catalogue.js';
import { registerImport } from '../catalogue/import.js';
import { registerAttempts } from '../attempts/attempts.js';
import { registerAttemptSignals } from '../attempts/signals.js';
import { registerTopics } from '../topics/topics.js';
import { registerLearningGoals } from '../topics/learning-goals.js';
import { registerTutorPreferences } from '../topics/tutor-preferences.js';
import { registerConversation, type TutorConversation } from '../tutor/conversation.js';
import { registerStudyTools } from '../topics/study-tools.js';
import { registerScoring } from '../scoring/scoring.js';
import { registerPlans } from '../plans/plans.js';
import { registerTransfer } from '../transfer/transfer.js';
import { ProblemBankService, registerProblemBank } from '../catalogue/problem-bank.js';

/** Routes for the study data itself: problems, attempts, scores, plans, backups. */
export function registerStudyRoutes(
  app: FastifyInstance,
  {
    db,
    clock,
    dbPath,
    demo,
    dailyBackup,
    conversationWorker,
  }: {
    db: Db;
    clock: () => Date;
    dbPath: string;
    demo?: boolean;
    dailyBackup?: boolean;
    conversationWorker?: TutorConversation;
  },
) {
  const bank = new ProblemBankService(db, clock);
  registerSettings(app, db);
  registerProblemBank(app, bank);
  registerSetup(app, db, clock, bank, demo);
  registerCatalogue(app, db);
  registerImport(app, db, clock);
  registerAttempts(app, db, clock);
  registerAttemptSignals(app, db, clock);
  registerTopics(app, db);
  registerLearningGoals(app, db, clock);
  registerTutorPreferences(app, db, clock);
  registerConversation(app, db, dbPath, conversationWorker);
  registerScoring(app, db, clock);
  registerPlans(app, db, clock);
  registerStudyTools(app, db, clock);
  registerTransfer(app, db, clock, dbPath, dailyBackup);
}
