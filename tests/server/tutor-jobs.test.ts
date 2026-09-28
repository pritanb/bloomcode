import { expect, it, vi } from 'vitest';
import { ApiError } from '../../src/server/db/errors.js';
import type { Insights } from '../../src/server/insights/service.js';
import { selectFocusTopics } from '../../src/server/tutor/topic-job.js';
import { analyzeNext } from '../../src/server/tutor/insight-job.js';
import type { GenerateRequest } from '../../src/server/tutor/generate.js';
function harness(outputs: unknown[], failure?: ApiError) {
  const complete = vi.fn(() => {
    if (failure) throw failure;
    return { ok: true };
  });
  const fail = vi.fn();
  const insights = {
    claim: () => ({
      job: { id: 'report-job', attemptId: null, claimId: 'claim' },
      context: { evidence: [{ id: 'e1' }] },
    }),
    complete,
    fail,
    refresh: async () => {},
  } as unknown as Insights;
  const generate = vi.fn(async (_request: GenerateRequest) => ({
    model: 'test',
    text: JSON.stringify(outputs.shift()),
  }));
  return { insights, complete, fail, generate, run: () => analyzeNext(insights, generate) };
}
it('delegates reports to Python and never calls the legacy generator', async () => {
  const h = harness([]);
  const report = vi.fn(async () => {});
  await analyzeNext(h.insights, h.generate, 1000, report);
  expect(report).toHaveBeenCalledOnce();
  expect(h.generate).not.toHaveBeenCalled();
});
it('fails a report clearly when Python is unavailable without a legacy fallback', async () => {
  const h = harness([]);
  await h.run();
  expect(h.generate).not.toHaveBeenCalled();
  expect(h.fail).toHaveBeenCalledWith('report-job', 'claim', expect.stringContaining('Python'));
});

it('selects exactly three topics from all 18 in one request, preserving AI order', async () => {
  const topics = Array.from({ length: 18 }, (_, i) => ({
    id: `t${i}`,
    name: `Topic ${i}`,
    score: 2,
    provisional: true,
    lastReviewed: null,
    recentAttempts: [],
    scoreMovements: [],
  }));
  const picks = [8, 2, 15].map((topicNumber) => ({
    topicNumber,
    reason: `Topic ${topicNumber - 1} is below the 4/5 target.`,
  }));
  const generate = vi.fn(async (_request: GenerateRequest) => ({
    model: null,
    text: JSON.stringify({ topics: picks }),
  }));
  expect(await selectFocusTopics(generate, topics)).toEqual({
    topicIds: ['t7', 't1', 't14'],
    reasons: picks.map((p) => p.reason),
  });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(generate.mock.calls)).toContain('Topic 17');
});
it('rejects incomplete, duplicate, unknown or over-long selections without additional AI requests', async () => {
  const topics = Array.from({ length: 4 }, (_, i) => ({
    id: `t${i}`,
    name: `Topic ${i}`,
    score: null,
    provisional: true,
    lastReviewed: null,
    recentAttempts: [],
    scoreMovements: [],
  }));
  const long = Array(31).fill('word').join(' ');
  for (const picks of [[1], [1, 1, 2], [1, 2, 5]]
    .map((numbers) => numbers.map((topicNumber) => ({ topicNumber, reason: 'Below target.' })))
    .concat([
      [1, 2, 3].map((topicNumber) => ({
        topicNumber,
        reason: topicNumber === 3 ? long : 'Below target.',
      })),
    ])) {
    const generate = vi.fn(async () => ({ model: null, text: JSON.stringify({ topics: picks }) }));
    await expect(selectFocusTopics(generate, topics)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  }
});
