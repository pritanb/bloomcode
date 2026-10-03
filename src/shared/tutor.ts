// Python AI workers use the Codex or Claude Agent SDK; Fastify configures and
// schedules their tasks. Off until chosen in Settings, because each provider
// spends the learner's ChatGPT or Claude plan.
export type TutorProvider = 'codex' | 'claude' | 'off';
export type TutorEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type TutorJobKind = 'review' | 'extraction' | 'report' | 'topics' | 'plan';
export type TutorErrorKind =
  | 'not_installed'
  | 'not_signed_in'
  | 'usage_limit'
  | 'model_unavailable'
  | 'timeout'
  | 'invalid_output'
  | 'crashed';
export const TUTOR_EFFORTS: TutorEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const TUTOR_JOB_KINDS: TutorJobKind[] = ['review', 'extraction', 'report', 'topics', 'plan'];

export interface TutorSettings {
  provider: TutorProvider;
  codexPath: string | null;
  /** The Codex model. */
  model: string;
  claudePath: string | null;
  claudeModel: string;
  /** Shared by both providers, which accept the same levels. */
  effort: Record<TutorJobKind, TutorEffort>;
}
export const defaultTutorSettings: TutorSettings = {
  provider: 'off',
  codexPath: null,
  model: 'gpt-6-luna',
  claudePath: null,
  claudeModel: 'opus',
  effort: { review: 'high', extraction: 'high', report: 'xhigh', topics: 'high', plan: 'high' },
};

export interface TutorRunnerStatus {
  provider: TutorProvider;
  /** The CLI the selected provider runs, once found or configured. */
  cliPath: string | null;
  activeKind: TutorJobKind | null;
  pausedUntil: string | null;
  lastError: { kind: TutorErrorKind; message: string; at: string } | null;
  lastSuccessAt: string | null;
}
export interface TutorTestResult {
  ok: boolean;
  path: string | null;
  version: string | null;
  model: string | null;
  ms: number;
  error: { kind: TutorErrorKind; message: string } | null;
}
/** One interview-help reply during an attempt; `analysis` only follows a new stuck time. */
export interface InterviewHelp {
  reply: string;
  hint: string;
  level: 'small' | 'major';
  analysis: string | null;
}
