import { expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { runInsightWorker, type ReportRequest } from '../../src/server/tutor/insight-worker.js';
import { ApiError } from '../../src/server/db/errors.js';
const runtime = {
  python: resolve('python/.venv/bin/python'),
  worker: resolve('tests/fixtures/insight-worker/worker.py'),
};
function fixture(mode = 'ok') {
  const insights = {
    currentJob: vi.fn(),
    reportAttempt: vi.fn((_job, _claim, id) => {
      if (id !== 'a1') throw new Error('Attempt outside claim');
      return { id, status: 'completed' };
    }),
    complete: vi.fn(),
  };
  const request = {
    insights,
    job: { id: 'report-job', claimId: 'claim' },
    context: { mode },
    budgetMs: 2000,
  } as unknown as ReportRequest;
  const controller = new AbortController();
  const run = () =>
    runInsightWorker(
      request,
      { model: 'test', effort: 'low', codexPath: null, signal: controller.signal },
      runtime,
    );
  return { insights, run, controller, request };
}
it('saves only through host validation and handles a bounded correction', async () => {
  const h = fixture();
  h.insights.complete.mockImplementationOnce(() => {
    throw new ApiError(400, 'EVIDENCE', 'Bad citation');
  });
  await h.run();
  expect(h.insights.complete).toHaveBeenCalledTimes(2);
  expect(h.insights.reportAttempt).toHaveBeenCalledWith('report-job', 'claim', 'a1');
});
it('rejects out-of-claim reads, malformed messages and premature exits', async () => {
  for (const mode of ['outside', 'malformed', 'crash']) {
    const h = fixture(mode);
    await expect(h.run()).rejects.toThrow();
    expect(h.insights.complete).not.toHaveBeenCalled();
  }
});
it('enforces deadlines and cancellation without saving', async () => {
  const h = fixture('hang');
  h.request.budgetMs = 50;
  await expect(h.run()).rejects.toThrow('timed out');
  const c = fixture('hang');
  const pending = c.run();
  c.controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect(c.insights.complete).not.toHaveBeenCalled();
});
it('aborts when evidence or assessment access changes', async () => {
  const h = fixture('hang');
  h.insights.currentJob.mockImplementation(() => {
    throw new Error('stale');
  });
  await expect(h.run()).rejects.toThrow('access or evidence changed');
  expect(h.insights.complete).not.toHaveBeenCalled();
});
