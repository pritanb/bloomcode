import type { GenerateReport } from './insight-worker.js';
import type { Insights } from '../insights/service.js';
import type { Generate } from './generate.js';
import { ANALYSIS_VERSION, extractionResult } from '../../shared/insights.js';
export function parseJson(text: string) {
  return JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, ''),
  );
}
/** Run the next learning-insights job: one attempt's extraction or the report. */
export async function analyzeNext(
  insights: Insights,
  generate: Generate,
  budgetMs = 210_000,
  report?: GenerateReport,
): Promise<boolean> {
  const work = insights.claim();
  if (!work) return false;
  const { job, context } = work;
  try {
    if (!job.attemptId) {
      if (!report)
        throw new Error(
          'Python Learning Insights worker is unavailable. Check the AI runtime setup.',
        );
      await report({
        insights,
        job,
        context: context as ReturnType<Insights['reportContext']>,
        budgetMs,
      });
    } else {
      const { text, model } = await generate({
        kind: 'extraction',
        context: { analysisVersion: ANALYSIS_VERSION, ...context },
        timeoutMs: budgetMs,
      });
      insights.complete(job.id, job.claimId!, extractionResult.parse(parseJson(text)), model);
      await insights.refresh();
    }
  } catch (error) {
    try {
      insights.fail(
        job.id,
        job.claimId!,
        (error instanceof Error ? error.message : 'Analysis failed').slice(0, 1000),
      );
    } catch {
      /* The claim is no longer current (evidence changed or analysis was paused). */
    }
  }
  return true;
}
