import { z } from 'zod';

export const planPick = z
  .object({
    problemId: z.string().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type PlanPick = z.infer<typeof planPick>;

/**
 * Problems the tutor proposes for today's plan; nothing changes until the learner
 * confirms. "replace" swaps today's unstarted items; started and finished work stays.
 */
export const planChange = z
  .object({
    mode: z.enum(['add', 'replace']),
    items: z.array(planPick).min(1).max(10),
  })
  .strict();
export const confirmedPlanChange = z
  .object({
    change: planChange,
    sourceConversation: z.string().min(1).max(200),
  })
  .strict();
