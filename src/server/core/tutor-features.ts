import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/db.js';
import { bearerMatches } from './auth.js';
import { createInsights, registerInsights } from '../insights/routes.js';
import type { Embed } from '../insights/embeddings.js';
import { registerTutor } from '../tutor/routes.js';
import type { TutorJobs } from '../tutor/jobs.js';
import { registerCloseout } from '../attempts/closeout.js';
import { registerAutoReview } from '../attempts/auto-review.js';
import { AutoReviewQueue } from '../attempts/auto-review-queue.js';
import { PlanDrafts, registerPlanDrafts } from '../plans/plan-drafts.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The tutor job queues, for tests that drive them without Codex. */
    tutorJobs: TutorJobs;
  }
}

/**
 * Everything the Codex tutor touches: insights search, topic analysis,
 * attempt closeout and auto-review. They share one set of job queues, and the
 * tutor worker wakes when embeddings are ready.
 */
export function registerTutorFeatures(
  app: FastifyInstance,
  {
    db,
    clock,
    token,
    tutorToken,
    dbPath,
    embed,
  }: {
    db: Db;
    clock: () => Date;
    token: string;
    tutorToken: string;
    dbPath: string;
    embed?: Embed;
  },
) {
  const { insights, topics } = createInsights(app, db, clock, dbPath, embed);
  const reviews = new AutoReviewQueue();
  // Bloom plans the day only while the tutor can run; the worker exists just below.
  let tutorActive = () => false;
  const drafts = new PlanDrafts(db, clock, () => tutorActive());
  const jobs: TutorJobs = { db, clock, reviews, insights, topics, drafts };
  const tutor = registerTutor(app, dbPath, clock, jobs);
  insights.onEmbeddingsReady = tutor.wake;
  app.decorate('tutorJobs', jobs);
  tutorActive = tutor.active;
  app.bloomPlanner = drafts;
  registerPlanDrafts(app, db, drafts, clock);
  registerCloseout(app, db, clock, reviews);
  registerAutoReview(app, db, reviews, tutor.active);
  registerInsights(
    app,
    db,
    insights,
    topics,
    (header) => bearerMatches(header, token) || bearerMatches(header, tutorToken),
    tutor,
  );
}
