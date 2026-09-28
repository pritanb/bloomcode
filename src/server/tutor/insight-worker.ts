import { z } from 'zod';
import type { Insights } from '../insights/service.js';
import type { InsightJob } from '../../shared/insights.js';
import { ApiError } from '../db/errors.js';
import { runAIWorker, type WorkerOptions } from './ai-process.js';
import { tutorRuntimePaths } from './conversation.js';

export interface ReportRequest {
  insights: Insights;
  job: InsightJob;
  context: ReturnType<Insights['reportContext']>;
  budgetMs: number;
}
export type GenerateReport = (request: ReportRequest) => Promise<void>;

export async function runInsightWorker(
  request: ReportRequest,
  options: WorkerOptions,
  runtime = tutorRuntimePaths(),
): Promise<void> {
  const id = request.job.claimId!;
  let saved = false;
  await runAIWorker(
    { id, kind: 'report', context: request.context, timeoutMs: request.budgetMs },
    { ...options, entry: 'insights_worker.py' },
    {
      check: () => request.insights.currentJob(request.job.id, id),
      evidence: (attemptId) => request.insights.reportAttempt(request.job.id, id, attemptId),
      candidate: (report) => {
        if (saved) throw new Error('Report already saved.');
        try {
          request.insights.complete(request.job.id, id, report, options.model);
          saved = true;
          return undefined;
        } catch (error) {
          if (error instanceof z.ZodError)
            return error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.join('.')}: ${issue.code}`)
              .join('; ');
          if (error instanceof ApiError && ['VALIDATION', 'EVIDENCE'].includes(error.code))
            return error.message.slice(0, 1500);
          throw error;
        }
      },
      completed: () => {
        if (!saved) throw new Error('Report completed without a validated candidate.');
      },
    },
    runtime,
  );
}
