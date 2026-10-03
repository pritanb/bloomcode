import { z } from 'zod';
/**
 * Recommendations come from the per-topic training ladder, not from lists. The target
 * is the rating Bloom trains each topic up to (1,850 ≈ the upper range of Mediums,
 * where FAANG screens sit); topics at the target only get due reviews.
 */
export const recommendationSchema = z
  .object({ targetRating: z.number().int().min(1200).max(2600) })
  .strict();
export type RecommendationSettings = z.infer<typeof recommendationSchema>;
export const defaultRecommendations: RecommendationSettings = { targetRating: 1850 };
