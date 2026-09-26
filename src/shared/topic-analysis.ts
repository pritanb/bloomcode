import { z } from 'zod';
import type { TutorRunnerStatus } from './tutor.js';
import type { Topic } from './contracts.js';
const id = z.string().min(1).max(200);
export const topicPriorityInput = z
  .object({
    topicId: id,
    importance: z.enum(['high', 'medium', 'low']),
    reason: z.string().trim().min(1).max(600),
    action: z.string().trim().min(1).max(400),
  })
  .strict();
export type TopicPriority = z.infer<typeof topicPriorityInput>;
export const TOPIC_READINESS_TARGET = 4;
export const TOPIC_REASON_MAX_WORDS = 30;
export const topicReason = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (r) => r.split(/\s+/).length <= TOPIC_REASON_MAX_WORDS,
    `Reason must contain at most ${TOPIC_REASON_MAX_WORDS} words`,
  );
export const TOPIC_PRIORITY_RULES = `Include topicPriorities: one entry per supplied topic (topicId, importance high|medium|low, reason, action). Estimate importance for general coding interviews, not a particular employer; label it as a judgment, never invent frequency statistics. Explain interview relevance and the gap from the planning target of 4/5. Scores are saved evidence, not a probability of passing. Null scores mean unassessed, never zero ability. Provisional scores require confirmation. A score of 4 or more needs maintenance, not remediation. Give one concrete next practice action per topic, without revealing problem solutions. Use only supplied topic IDs. Do not change scores or schedules.`;

export interface TopicAnalysisRecord {
  enabled: boolean;
  fingerprint: string;
  status: 'idle' | 'pending' | 'running' | 'done' | 'failed';
  claimId: string | null;
  claimedAt: number;
  error: string | null;
  report: {
    fingerprint: string;
    createdAt: string;
    topicIds?: string[];
    reasons?: string[];
    topicPriorities: TopicPriority[];
    model: string | null;
  } | null;
}
export type AnalysisTopic = Pick<Topic, 'id' | 'name' | 'score' | 'provisional' | 'lastReviewed'>;
export interface TopicAnalysisStatus {
  enabled: boolean;
  hidden: boolean;
  topics: AnalysisTopic[];
  report: TopicAnalysisRecord['report'];
  status: TopicAnalysisRecord['status'];
  runner?: TutorRunnerStatus;
}

export interface TopicAnalysisContext extends AnalysisTopic {
  recentAttempts: {
    date: string;
    outcome: string | null;
    help: string;
    evidence: string;
    confidence: number | null;
    difficulty: string | null;
    activeSeconds: number | null;
  }[];
  scoreMovements: { date: string; oldScore: number; newScore: number; attemptId: string | null }[];
}
