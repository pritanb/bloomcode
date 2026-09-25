import { z } from 'zod';
import type { Topic } from './contracts.js';
import type { McpConnectionStatus } from './mcp-connection.js';
const id=z.string().min(1).max(200);
export const topicPriorityInput = z.object({
  topicId: id,
  importance: z.enum(['high', 'medium', 'low']),
  reason: z.string().trim().min(1).max(600),
  action: z.string().trim().min(1).max(400),
}).strict();
export type TopicPriority = z.infer<typeof topicPriorityInput>;
export const TOPIC_READINESS_TARGET = 4;
export const TOPIC_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const TOPIC_PRIORITY_RULES = `Include topicPriorities: one entry per supplied topic (topicId, importance high|medium|low, reason, action). Estimate importance for general coding interviews, not a particular employer; label it as a judgment, never invent frequency statistics. Explain interview relevance and the gap from the planning target of 4/5. Scores are saved evidence, not a probability of passing. Null scores mean unassessed, never zero ability. Provisional scores require confirmation. A score of 4 or more needs maintenance, not remediation. Give one concrete next practice action per topic, without revealing problem solutions. Use only supplied topic IDs. Do not change scores or schedules.`;

export const topicAnalysisRecordSchema=z.object({
  kind:z.literal('topic_analysis'),id:z.literal('topic-analysis'),enabled:z.boolean(),
  fingerprint:z.string(),status:z.enum(['idle','pending','running','done','failed']),
  claimId:z.string().nullable(),claimedAt:z.number(),error:z.string().nullable(),
  report:z.object({fingerprint:z.string(),createdAt:z.iso.datetime(),topicIds:z.array(id).max(3).optional(),topicPriorities:z.array(topicPriorityInput).max(200).default([]),model:z.string().nullable()}).strict().nullable(),
}).strict();
export type TopicAnalysisRecord=z.infer<typeof topicAnalysisRecordSchema>;
export type AnalysisTopic=Pick<Topic,'id'|'name'|'score'|'provisional'|'lastReviewed'>;
export interface TopicAnalysisStatus {
  enabled:boolean;hidden:boolean;topics:AnalysisTopic[];report:TopicAnalysisRecord['report'];stale:boolean;
  status:TopicAnalysisRecord['status'];connection?:McpConnectionStatus;
}

export interface TopicAnalysisContext extends AnalysisTopic {
  recentAttempts: { date:string; outcome:string|null; help:string; evidence:string; confidence:number|null; difficulty:string|null; activeSeconds:number|null }[];
  scoreMovements: { date:string; oldScore:number; newScore:number; attemptId:string|null }[];
}
