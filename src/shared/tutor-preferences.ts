import { z } from 'zod';

export const preferenceChange = z
  .object({
    explanationDepth: z.enum(['concise', 'balanced', 'detailed']),
    hintStyle: z.enum(['questions', 'progressive', 'direct']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const confirmedPreferenceChange = z
  .object({
    change: preferenceChange,
    sourceConversation: z.string().min(1).max(200),
  })
  .strict();
