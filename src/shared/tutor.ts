// Who generates tutor text: a Codex CLI child process run by the app, the MCP
// client via sampling (Hermes), or nobody.
export type TutorProvider = 'codex' | 'mcp-sampling' | 'off';
export type TutorEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type TutorJobKind = 'review' | 'extraction' | 'report' | 'topics';
export type CodexErrorKind = 'not_installed' | 'not_signed_in' | 'usage_limit' | 'model_unavailable' | 'timeout' | 'invalid_output' | 'crashed';
export const TUTOR_EFFORTS: TutorEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const TUTOR_JOB_KINDS: TutorJobKind[] = ['review', 'extraction', 'report', 'topics'];

export interface TutorSettings {
  provider: TutorProvider;
  codexPath: string | null;
  model: string;
  effort: Record<TutorJobKind, TutorEffort>;
}
export const defaultTutorSettings: TutorSettings = {
  provider: 'mcp-sampling',
  codexPath: null,
  model: 'gpt-6-luna',
  effort: { review: 'high', extraction: 'high', report: 'xhigh', topics: 'high' },
};

export interface TutorRunnerStatus {
  provider: TutorProvider;
  codexPath: string | null;
  activeKind: TutorJobKind | null;
  pausedUntil: string | null;
  lastError: { kind: CodexErrorKind; message: string; at: string } | null;
  lastSuccessAt: string | null;
}
export interface TutorTestResult { ok: boolean; path: string | null; version: string | null; model: string | null; ms: number; error: { kind: CodexErrorKind; message: string } | null }
