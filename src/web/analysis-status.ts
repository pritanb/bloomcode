import type { InsightStatus } from '../shared/insights';
import type { TutorRunnerStatus } from '../shared/tutor';

/** A tutor setup problem that stops all AI work until it is fixed, or null. */
export function tutorProblem(runner: TutorRunnerStatus | undefined): { title: string; detail: string } | null {
  if (runner?.provider === 'off') return { title: 'AI tutor is off', detail: 'Choose a tutor in Settings to analyze new attempts. Saved reports are kept.' };
  if (runner?.provider !== 'codex' || !runner.pausedUntil || !runner.lastError) return null;
  const until = new Date(runner.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  switch (runner.lastError.kind) {
    case 'not_installed': return { title: 'Codex not found', detail: runner.lastError.message };
    case 'not_signed_in': return { title: 'Codex is not signed in', detail: 'Run `codex login` in a terminal, then press Test in Settings.' };
    case 'usage_limit': return { title: 'Codex usage limit reached', detail: `Analysis resumes after ${until}. Saved work is kept.` };
    case 'model_unavailable': return { title: 'Model unavailable in Codex', detail: 'Choose another model in Settings.' };
    default: return { title: 'Codex needs attention', detail: runner.lastError.message };
  }
}

export function analysisStatus(data: InsightStatus) {
  if (data.hidden) return { title: 'Analysis hidden during assessment', detail: 'Finish your mixed assessment to see recommendations.', busy: false };
  if (!data.enabled) return { title: 'Automatic analysis is off', detail: 'Saved reports are kept.', busy: false };
  const problem = tutorProblem(data.runner);
  if (problem) return { ...problem, busy: false, blocked: true };
  // MCP heartbeat states only describe the sampling provider.
  const mcp = !data.runner || data.runner.provider === 'mcp-sampling';
  if (mcp && data.connection?.state === 'disconnected') return { title: 'MCP tutor disconnected', detail: 'No heartbeat received for 45 seconds. Reconnect LeetCode Tutor in your tutor app. Saved work is kept; pending analysis resumes when it reconnects.', busy: false };
  if (mcp && data.connection?.state === 'connected' && !data.connection.sampling) return { title: 'Tutor connected · sampling unavailable', detail: 'Enable sampling in your tutor app so it can generate AI reports.', busy: false };
  if (mcp && data.connection?.state === 'connected' && !data.connection.automaticReviews) return { title: 'Tutor connected · background analysis disabled', detail: 'Enable automatic reviews in the MCP adapter, then reconnect it to resume reports.', busy: false };
  if (data.worker?.timedOut) return { title: 'Tutor response timed out', detail: mcp ? 'No result arrived before the request expired. The next tutor check-in will retry. If this persists, reconnect your tutor with sampling enabled.' : 'No result arrived before the request expired. It will be retried automatically.', busy: false };
  if (data.reportStatus === 'generating' || data.worker?.activeKind === 'report') return { title: 'Generating report…', detail: 'Attempt analysis and report generation are separate steps. The tutor accepted this request; waiting for its result. A quiet connection during generation is normal.', busy: true };
  if (data.worker?.activeKind === 'attempt') return { title: 'Analyzing an attempt…', detail: 'The tutor accepted this request; waiting for its result before moving to the next step.', busy: true };
  if (data.reportStatus === 'failed' || data.failed > 0 || data.embeddingStatus === 'failed') return { title: 'Analysis needs attention', detail: data.error ?? 'An analysis request failed. Retry analysis to try again.', busy: false };
  if (data.reportStatus === 'ready' && data.pending === 0) return { title: 'Report up to date', detail: (data.connection?.state === 'connected' || data.tutorConnected) ? 'Tutor checked in recently. New evidence will be analyzed automatically.' : 'No work is waiting. The tutor has not checked in recently; this does not invalidate your saved report.', busy: false };
  if (data.total === 0) return { title: 'Waiting for practice evidence', detail: 'Complete a practice attempt to begin analysis.', busy: false };
  if (data.embeddingStatus === 'loading') return { title: 'Preparing local search…', detail: 'The app is preparing saved evidence for the tutor.', busy: true };
  if (mcp && data.connection?.state !== 'connected' && !data.tutorConnected) return { title: 'Waiting for tutor check-in', detail: 'No recent analysis check-in and no active request. Your tutor may be busy reviewing an attempt. If this persists, reconnect it and confirm sampling is enabled.', busy: false };
  return { title: 'Analysis queued', detail: `${data.pending} jobs waiting or in progress. The tutor checked in recently.`, busy: false };
}
