import { z } from 'zod';

export const goalChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), text: z.string().trim().min(1).max(1000) }).strict(),
  z
    .object({
      action: z.literal('set_state'),
      goalId: z.string().uuid(),
      text: z.string().trim().min(1).max(1000),
      expectedVersion: z.number().int().nonnegative(),
      state: z.enum(['active', 'completed', 'abandoned']),
    })
    .strict(),
]);
export const confirmedGoalChange = z
  .object({
    change: goalChange,
    sourceConversation: z.string().min(1).max(200),
  })
  .strict();
