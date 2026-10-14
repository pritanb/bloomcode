import { z } from 'zod';

export const slug = z
  .string()
  .max(200)
  .regex(/^[a-z0-9-]+$/);

/**
 * Who plans the learner's days, as Bloom proposes it in chat. "list" with slugs replaces the
 * study list (finished problems stay finished); "list" without slugs resumes the saved one;
 * "bloom" hands the days back to Bloom and keeps the list. `preview` is only shown on the
 * confirmation card.
 */
export const studyListChange = z
  .object({
    planSource: z.enum(['bloom', 'list']),
    name: z.string().trim().min(1).max(100).nullable(),
    slugs: z.array(slug).min(1).max(500).nullable(),
    preview: z
      .object({
        total: z.number().int().nonnegative(),
        inLibrary: z.number().int().nonnegative(),
        firstUp: z.array(z.string().max(200)).max(5),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StudyListChange = z.infer<typeof studyListChange>;
export const confirmedStudyListChange = z
  .object({
    change: studyListChange,
    sourceConversation: z.string().min(1).max(200),
  })
  .strict();
