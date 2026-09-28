import { expect, it } from 'vitest';
import { reportResult, targetedReportResult } from '../../src/shared/insights.js';
const legacy = {
  title: 'Keep possible answers',
  kind: 'focus',
  explanation: 'A reflection reports uncertainty.',
  action: 'Trace the bounds.',
  evidenceIds: ['o1'],
  caveat: '',
  suggestions: [],
};
it('reads legacy reports and requires exercises for newly generated reports', () => {
  expect(reportResult.safeParse({ findings: [legacy], limitation: '' }).success).toBe(true);
  expect(targetedReportResult.safeParse({ findings: [legacy], limitation: '' }).success).toBe(
    false,
  );
  const finding = {
    ...legacy,
    exercise: 'Trace two elements.',
    successCheck: 'Both branches shrink the interval.',
  };
  const report = { findings: [finding], limitation: '' };
  expect(targetedReportResult.parse(report)).toEqual(report);
  expect(reportResult.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
  expect(
    targetedReportResult.safeParse({ ...report, findings: Array(4).fill(finding) }).success,
  ).toBe(false);
});

it('preserves legacy and targeted findings through a native backup and reopen', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { openDb, insert, many } = await import('../../src/server/db/db.js');
  const { backupNow } = await import('../../src/server/transfer/transfer.js');
  const dir = mkdtempSync(join(tmpdir(), 'insight-backup-'));
  const path = join(dir, 'study.sqlite');
  const db = openDb(path);
  try {
    const findings = [
      legacy,
      { ...legacy, exercise: 'Trace two elements.', successCheck: 'Both branches shrink.' },
    ];
    insert(db, 'insight_reports', {
      id: 'saved',
      findings,
      limitation: '',
      createdAt: '2026-09-28',
      fingerprint: 'old',
      total: 1,
      analyzed: 1,
      evidenceIds: ['o1'],
      model: 'test',
      analysisVersion: 'learning-insights-v1',
      durationMs: 10,
    });
    const backup = await backupNow(db, () => new Date('2026-09-28'), path);
    const restored = openDb(backup.path);
    try {
      const [row] = many<{ findings: string }>(restored, 'SELECT findings FROM insight_reports');
      expect(JSON.parse(row.findings)).toEqual(findings);
      expect(
        reportResult.parse({ findings: JSON.parse(row.findings), limitation: '' }).findings,
      ).toEqual(findings);
    } finally {
      restored.close();
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
