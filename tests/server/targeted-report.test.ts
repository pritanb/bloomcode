import { expect, it } from 'vitest';
import { reportResult, targetedReportResult } from '../../src/shared/insights.js';
const legacy = { title: 'Keep possible answers', kind: 'focus', explanation: 'A reflection reports uncertainty.', action: 'Trace the bounds.', evidenceIds: ['o1'], caveat: '', suggestions: [] };
it('reads legacy reports and requires exercises for newly generated reports', () => {
  expect(reportResult.safeParse({ findings: [legacy], limitation: '' }).success).toBe(true);
  expect(targetedReportResult.safeParse({ findings: [legacy], limitation: '' }).success).toBe(false);
  const finding = { ...legacy, exercise: 'Trace two elements.', successCheck: 'Both branches shrink the interval.' };
  const report = { findings: [finding], limitation: '' };
  expect(targetedReportResult.parse(report)).toEqual(report);
  expect(reportResult.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
  expect(targetedReportResult.safeParse({ ...report, findings: Array(4).fill(finding) }).success).toBe(false);
});
