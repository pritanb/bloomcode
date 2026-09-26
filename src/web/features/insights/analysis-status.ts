import type { InsightStatus } from '../../../shared/insights';
import type { TutorRunnerStatus } from '../../../shared/tutor';

/** A tutor setup problem that stops all AI work until it is fixed, or null. */
export function tutorProblem(
  runner: TutorRunnerStatus | undefined,
): { title: string; detail: string } | null {
  if (runner?.provider === 'off')
    return {
      title: 'AI tutor is off',
      detail: 'Choose a tutor in Settings to analyze new attempts. Saved reports are kept.',
    };
  if (runner?.provider !== 'codex' || !runner.pausedUntil || !runner.lastError) return null;
  const until = new Date(runner.pausedUntil).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  switch (runner.lastError.kind) {
    case 'not_installed':
      return { title: 'Codex not found', detail: runner.lastError.message };
    case 'not_signed_in':
      return {
        title: 'Codex is not signed in',
        detail: 'Run `codex login` in a terminal, then press Test in Settings.',
      };
    case 'usage_limit':
      return {
        title: 'Codex usage limit reached',
        detail: `Analysis resumes after ${until}. Saved work is kept.`,
      };
    case 'model_unavailable':
      return { title: 'Model unavailable in Codex', detail: 'Choose another model in Settings.' };
    default:
      return { title: 'Codex needs attention', detail: runner.lastError.message };
  }
}

export function analysisStatus(data: InsightStatus) {
  if (data.hidden)
    return {
      title: 'Analysis hidden during assessment',
      detail: 'Finish your mixed assessment to see recommendations.',
      busy: false,
    };
  if (!data.enabled)
    return { title: 'Automatic analysis is off', detail: 'Saved reports are kept.', busy: false };
  const problem = tutorProblem(data.runner);
  if (problem) return { ...problem, busy: false, blocked: true };
  if (data.worker?.timedOut)
    return {
      title: 'Tutor response timed out',
      detail: 'No result arrived before the request expired. It will be retried automatically.',
      busy: false,
    };
  if (data.reportStatus === 'generating' || data.worker?.activeKind === 'report')
    return {
      title: 'Generating report…',
      detail:
        'Attempt analysis and report generation are separate steps. The tutor accepted this request; waiting for its result. A quiet connection during generation is normal.',
      busy: true,
    };
  if (data.worker?.activeKind === 'attempt')
    return {
      title: 'Analyzing an attempt…',
      detail:
        'The tutor accepted this request; waiting for its result before moving to the next step.',
      busy: true,
    };
  if (data.reportStatus === 'failed' || data.failed > 0 || data.embeddingStatus === 'failed')
    return {
      title: 'Analysis needs attention',
      detail: data.error ?? 'An analysis request failed. Retry analysis to try again.',
      busy: false,
    };
  if (data.reportStatus === 'ready' && data.pending === 0)
    return {
      title: 'Report up to date',
      detail: data.tutorConnected
        ? 'New evidence will be analyzed automatically.'
        : 'The AI tutor is off or paused. Your saved report is kept.',
      busy: false,
    };
  if (data.total === 0)
    return {
      title: 'Waiting for practice evidence',
      detail: 'Complete a practice attempt to begin analysis.',
      busy: false,
    };
  if (data.embeddingStatus === 'loading')
    return {
      title: 'Preparing local search…',
      detail: 'The app is preparing saved evidence for the tutor.',
      busy: true,
    };
  return {
    title: 'Analysis queued',
    detail: `${data.pending} jobs waiting or in progress.`,
    busy: false,
  };
}
