// Python AI workers use the Codex SDK; Fastify configures and schedules their tasks.
// Off until chosen in Settings, because Codex spends the learner's ChatGPT plan.
export type TutorProvider = 'codex' | 'off';
export type TutorEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type TutorJobKind = 'review' | 'extraction' | 'report' | 'topics' | 'plan';
export type CodexErrorKind =
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
  model: string;
  effort: Record<TutorJobKind, TutorEffort>;
}
export const defaultTutorSettings: TutorSettings = {
  provider: 'off',
  codexPath: null,
  model: 'gpt-6-luna',
  effort: { review: 'high', extraction: 'high', report: 'xhigh', topics: 'high', plan: 'high' },
};

export interface TutorRunnerStatus {
  provider: TutorProvider;
  codexPath: string | null;
  activeKind: TutorJobKind | null;
  pausedUntil: string | null;
  lastError: { kind: CodexErrorKind; message: string; at: string } | null;
  lastSuccessAt: string | null;
}
export interface TutorTestResult {
  ok: boolean;
  path: string | null;
  version: string | null;
  model: string | null;
  ms: number;
  error: { kind: CodexErrorKind; message: string } | null;
}
