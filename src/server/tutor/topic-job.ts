import { z } from 'zod';
import type { TopicAnalysis } from '../topics/topic-analysis.js';
import type { Generate } from './generate.js';
import {
  TOPIC_READINESS_TARGET,
  TOPIC_REASON_MAX_WORDS,
  topicReason,
  type TopicAnalysisContext,
} from '../../shared/topic-analysis.js';
import { parseJson } from './insight-job.js';

export async function selectFocusTopics(
  generate: Generate,
  topics: TopicAnalysisContext[],
): Promise<{ topicIds: string[]; reasons: string[] }> {
  // Short numeric references avoid asking the model to reproduce database IDs.
  const { text } = await generate({
    kind: 'topics',
    context: {
      reasonMaxWords: TOPIC_REASON_MAX_WORDS,
      readinessTarget: TOPIC_READINESS_TARGET,
      evidenceWindowDays: 28,
      topics: topics.map(({ id: _id, ...topic }, index) => ({ topicNumber: index + 1, ...topic })),
    },
    timeoutMs: 150_000,
  });
  const result = z
    .object({
      topics: z
        .array(
          z
            .object({
              topicNumber: z.number().int().min(1).max(topics.length),
              reason: topicReason,
            })
            .strict(),
        )
        .length(Math.min(3, topics.length))
        .refine((picks) => new Set(picks.map((p) => p.topicNumber)).size === picks.length),
    })
    .strict()
    .parse(parseJson(text));
  return {
    topicIds: result.topics.map((p) => topics[p.topicNumber - 1].id),
    reasons: result.topics.map((p) => p.reason),
  };
}

/** Run a requested "Where to focus" selection. Returns whether one was waiting. */
export async function analyzeTopicsNext(
  topics: TopicAnalysis,
  generate: Generate,
): Promise<boolean> {
  const work = topics.claim();
  if (!work) return false;
  try {
    const { topicIds, reasons } = await selectFocusTopics(generate, work.topics);
    topics.complete(work.job.claimId!, topicIds, reasons);
  } catch (error) {
    try {
      topics.fail(
        work.job.claimId!,
        (error instanceof Error ? error.message : 'Topic analysis failed').slice(0, 1000),
      );
    } catch {
      /* The request was turned off or superseded meanwhile. */
    }
  }
  return true;
}
