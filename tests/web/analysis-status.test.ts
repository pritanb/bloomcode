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
it('keeps showing an unexpired generation request as in progress', () => {
  expect(analysisStatus(base)).toMatchObject({ title: 'Generating report…', busy: true });
});
it('explains request expiry', () => {
  expect(
    analysisStatus({
      ...base,
      reportStatus: 'waiting',
      worker: {
        activeKind: 'report',
        startedAt: null,
        expiresAt: null,
        timedOut: true,
      },
    }).title,
  ).toBe('Tutor response timed out');
});
