import { expect, it } from 'vitest';
import { analysisStatus } from '../../src/web/features/insights/analysis-status';
import type { InsightStatus } from '../../src/shared/insights';
const base = {
  enabled: true,
  hidden: false,
  total: 118,
  analyzed: 118,
  pending: 1,
  failed: 0,
  tutorConnected: false,
  embeddingStatus: 'ready',
  error: null,
  report: null,
  stale: true,
  reportStatus: 'generating',
  observations: [],
  suggestions: [],
} satisfies InsightStatus;
it('does not report a lost connection just because generation exceeds the old 30 second check-in window', () => {
  expect(analysisStatus(base)).toMatchObject({ title: 'Generating report…', busy: true });
  expect(
    analysisStatus({
      ...base,
      connection: { state: 'connected', lastSeenAt: null, sampling: true, automaticReviews: true },
    }).title,
  ).toBe('Generating report…');
});
it('a confirmed missing heartbeat overrides an unexpired generation request', () => {
  expect(
    analysisStatus({
      ...base,
      connection: {
        state: 'disconnected',
        lastSeenAt: null,
        sampling: false,
        automaticReviews: false,
      },
    }),
  ).toMatchObject({ title: 'MCP tutor disconnected', busy: false });
});
it('explains request expiry and separates connection from sampling support', () => {
  expect(
    analysisStatus({
      ...base,
      reportStatus: 'waiting',
      worker: {
        lastContactAt: null,
        activeKind: 'report',
        startedAt: null,
        expiresAt: null,
        timedOut: true,
      },
    }).title,
  ).toBe('Tutor response timed out');
  expect(
    analysisStatus({
      ...base,
      connection: { state: 'connected', lastSeenAt: null, sampling: false, automaticReviews: true },
    }).title,
  ).toBe('Tutor connected · sampling unavailable');
});
