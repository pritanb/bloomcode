import { expect, it, vi } from 'vitest';
import { ApiError } from '../../src/server/db/errors.js';
import type { Insights } from '../../src/server/insights/service.js';
import { selectFocusTopics } from '../../src/server/tutor/topic-job.js';
import { analyzeNext } from '../../src/server/tutor/insight-job.js';
import type { GenerateRequest } from '../../src/server/tutor/generate.js';
import { conciseReportResult, reportResult } from '../../src/shared/insights.js';
const finding = {
  title: 'Check your search bounds',
  kind: 'focus',
  action: 'Explain why both bounds contain the answer before searching.',
  explanation: 'Two notes describe difficulty choosing the upper bound.',
  evidenceIds: ['e1'],
  caveat: 'Self-reported evidence.',
  suggestions: [],
};
const valid = { findings: [finding], limitation: 'Retrieved evidence only.' };
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
  return { complete, fail, generate, run: () => analyzeNext(insights, generate) };
}
it('enforces writing limits without breaking legacy saved reports', () => {
  for (const [field, words] of [
    ['title', 7],
    ['action', 26],
    ['explanation', 36],
  ] as const) {
    const long = {
      ...valid,
      findings: [{ ...finding, [field]: Array(words).fill('word').join(' ') }],
    };
    expect(conciseReportResult.safeParse(long).success).toBe(false);
    expect(reportResult.safeParse(long).success).toBe(true);
  }
  expect(conciseReportResult.safeParse(valid).success).toBe(true);
});
it('corrects invalid output once and sends specific errors back to the tutor', async () => {
  const h = harness([
    { ...valid, findings: [{ ...finding, title: 'one two three four five six seven' }] },
    valid,
  ]);
  await h.run();
  expect(h.generate).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(h.generate.mock.calls[1])).toContain('Habit must contain at most 6 words');
  expect(h.complete).toHaveBeenCalledTimes(1);
});
it('stops after one failed correction and does not save invalid reports', async () => {
  const h = harness([{}, {}]);
  await h.run();
  expect(h.generate).toHaveBeenCalledTimes(2);
  expect(h.complete).not.toHaveBeenCalled();
  expect(h.fail).toHaveBeenCalled();
});
it('corrects invalid citations but does not retry stale claims', async () => {
  const evidence = harness([valid, valid], new ApiError(400, 'EVIDENCE', 'Unknown evidence ID'));
  await evidence.run();
  expect(evidence.generate).toHaveBeenCalledTimes(2);
  const stale = harness([valid], new ApiError(409, 'CONFLICT', 'Evidence changed'));
  await stale.run();
  expect(stale.generate).toHaveBeenCalledTimes(1);
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
