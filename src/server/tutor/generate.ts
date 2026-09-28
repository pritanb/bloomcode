import type { TutorJobKind } from '../../shared/tutor.js';

/** Task data only. Python owns prompts, schemas and model calls. */
export interface GenerateRequest {
  kind: Exclude<TutorJobKind, 'report'> | 'connection';
  context: unknown;
  timeoutMs: number;
}
export type Generate = (
  request: GenerateRequest,
) => Promise<{ text: string; model: string | null }>;
