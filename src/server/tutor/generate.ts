import type { TutorJobKind } from '../../shared/tutor.js';

// One model call. The app's Codex worker runs the model.
export interface GenerateRequest {
  kind: TutorJobKind;
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}
export type Generate = (
  request: GenerateRequest,
) => Promise<{ text: string; model: string | null }>;
