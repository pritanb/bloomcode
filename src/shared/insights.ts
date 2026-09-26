import { topicPriorityInput, topicAnalysisRecordSchema } from './topic-analysis.js';
import type { TopicPriority } from './topic-analysis.js';
export {
  topicPriorityInput,
  TOPIC_READINESS_TARGET,
  TOPIC_PRIORITY_RULES,
} from './topic-analysis.js';
export type { TopicPriority } from './topic-analysis.js';
import type { TutorRunnerStatus } from './tutor.js';
import { z } from 'zod';
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const ANALYSIS_VERSION = 'learning-insights-v1';
export const REPORT_VERSION = 'learning-report-independent-v4';
export const REPORT_WRITING_RULES = `Use this required format for every finding:
- title (Habit): at most 6 words, plain language.
- action (Next time): at most 25 words, one concrete action, starting with a verb.
- explanation (Why): at most 35 words linking the action to the supplied evidence.
Use familiar words and short sentences. Avoid vague advice such as "improve your understanding", abstract phrases like "central mechanism", and multiple tasks bundled into one action. Preserve uncertainty and contrary evidence in caveat; never remove qualifiers just to shorten a claim. Keep caveats and practice reasons brief. Do not invent evidence.
Example: title="Check your search bounds"; action="Explain why your lower and upper bounds contain the answer before starting binary search."; explanation="Two attempts mention difficulty choosing the upper bound." Use this example only for style, never as evidence.`;
const id = z.string().min(1).max(200);
const text = z.string().trim().min(1).max(2000);
export const observationInput = z
  .object({
    summary: z.string().trim().min(1).max(800),
    polarity: z.enum(['difficulty', 'strength']),
    evidenceType: z.enum(['learner_reported', 'code_inferred', 'outcome_observed']),
    sourceField: z.enum([
      'code',
      'notes',
      'takeaway',
      'mistakeLabels',
      'outcome',
      'help',
      'confidence',
    ]),
    excerpt: z.string().min(1).max(2000),
  })
  .strict();
export const findingInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.enum(['recurring', 'single_problem', 'improvement', 'focus']),
    explanation: text,
    action: text,
    evidenceIds: z.array(id).min(1).max(12),
    caveat: z.string().max(1000),
    suggestions: z
      .array(z.object({ problemId: id, reason: z.string().trim().min(1).max(500) }).strict())
      .max(3),
  })
  .strict();
export const extractionResult = z
  .object({ observations: z.array(observationInput).max(8), limitation: z.string().max(1000) })
  .strict();
export const reportResult = z
  .object({
    findings: z.array(findingInput).max(6),
    topicPriorities: z.array(topicPriorityInput).max(200).optional(),
    limitation: z.string().max(1500),
  })
  .strict();
// Keep the saved/export schema permissive for older reports. Enforce this
// contract only on newly generated reports; never truncate advice to make it fit.
const conciseText = (label: string, words: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => value.split(/\s+/u).length <= words,
      `${label} must contain at most ${words} words`,
    )
    .describe(`${label}: maximum ${words} words`);
export const conciseReportResult = reportResult.extend({
  findings: z
    .array(
      findingInput.extend({
        title: conciseText('Habit', 6, 200),
        action: conciseText('Next time', 25, 2000),
        explanation: conciseText('Why', 35, 2000),
      }),
    )
    .max(6),
});

export type ObservationInput = z.infer<typeof observationInput>;
export type Finding = z.infer<typeof findingInput>;
export interface Observation extends ObservationInput {
  id: string;
  kind: 'observation';
  attemptId: string;
  problemId: string;
  fingerprint: string;
  createdAt: string;
  analysisVersion: string;
  model: string | null;
}
export interface InsightReport {
  id: string;
  kind: 'report';
  findings: Finding[];
  topicPriorities?: TopicPriority[];
  limitation: string;
  createdAt: string;
  fingerprint: string;
  analyzed: number;
  total: number;
  evidenceIds: string[];
  model: string | null;
  analysisVersion: string;
  durationMs: number;
}
export interface InsightStatus {
  runner?: TutorRunnerStatus;
  enabled: boolean;
  hidden: boolean;
  total: number;
  analyzed: number;
  pending: number;
  failed: number;
  worker?: {
    activeKind: 'attempt' | 'report' | null;
    startedAt: string | null;
    expiresAt: string | null;
    timedOut: boolean;
  };
  tutorConnected: boolean;
  embeddingStatus: 'idle' | 'loading' | 'ready' | 'failed';
  error: string | null;
  report: InsightReport | null;
  stale: boolean;
  reportStatus: 'idle' | 'waiting' | 'generating' | 'failed' | 'ready';
  observations: (Observation & { problemTitle: string; studyDate: string; topics: string[] })[];
  suggestions: { id: string; title: string }[];
}
export const learningRecordSchema = z.discriminatedUnion('kind', [
  topicAnalysisRecordSchema,
  z.object({ kind: z.literal('state'), id: z.literal('state'), enabled: z.boolean() }).strict(),
  observationInput
    .extend({
      kind: z.literal('observation'),
      id,
      attemptId: id,
      problemId: id,
      fingerprint: id,
      createdAt: z.iso.datetime(),
      analysisVersion: id,
      model: z.string().max(300).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('correction'),
      id,
      observationId: id,
      attemptId: id,
      summary: text,
      sourceField: observationInput.shape.sourceField,
      excerpt: text,
      reason: text,
      createdAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('job'),
      id,
      attemptId: id.nullable(),
      fingerprint: id,
      status: z.enum(['pending', 'running', 'done', 'failed']),
      claimId: id.nullable(),
      claimedAt: z.number(),
      error: z.string().max(1000).nullable(),
      model: z.string().max(300).nullable(),
      durationMs: z.number().nonnegative(),
      limitation: z.string().max(1000),
      evidenceIds: z.array(id).max(100),
      questionIds: z.array(id).max(30),
    })
    .strict(),
  reportResult
    .extend({
      kind: z.literal('report'),
      id,
      fingerprint: id,
      createdAt: z.iso.datetime(),
      analyzed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      evidenceIds: z.array(id).max(100),
      model: z.string().max(300).nullable(),
      analysisVersion: id,
      durationMs: z.number().nonnegative(),
    })
    .strict(),
]);
export type LearningRecord = z.infer<typeof learningRecordSchema>;
export type InsightJob = Extract<LearningRecord, { kind: 'job' }>;
