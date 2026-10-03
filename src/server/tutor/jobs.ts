import type { GenerateReport } from './insight-worker.js';
import type { Db } from '../db/db.js';
import type { AutoReviewQueue } from '../attempts/auto-review-queue.js';
import type { Insights } from '../insights/service.js';
import type { TopicAnalysis } from '../topics/topic-analysis.js';
import type { Generate } from './generate.js';
import { reviewNext } from './review-job.js';
import { analyzeNext } from './insight-job.js';
import { analyzeTopicsNext } from './topic-job.js';
import { draftPlanNext } from './plan-job.js';
import type { PlanDrafts } from '../plans/plan-drafts.js';

/** The queues the Codex worker takes work from. */
export interface TutorJobs {
  db: Db;
  clock: () => Date;
  reviews: AutoReviewQueue;
  insights: Insights;
  topics: TopicAnalysis;
  drafts: PlanDrafts;
}
/** Run the next queued job: attempt reports, today's plan draft, learning insights, then topic picks. */
export async function runNextJob(
  jobs: TutorJobs,
  generate: Generate,
  reportBudgetMs?: number,
  report?: GenerateReport,
): Promise<boolean> {
  return (
    (await reviewNext(jobs, generate)) ||
    (await draftPlanNext(jobs.drafts, generate)) ||
    (await analyzeNext(jobs.insights, generate, reportBudgetMs, report)) ||
    (await analyzeTopicsNext(jobs.topics, generate))
  );
}
