import { it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runAIWorker } from '../../src/server/tutor/ai-process.js';
const runtime = {
  python: resolve('python/.venv/bin/python'),
  worker: resolve('tests/fixtures/insight-worker/worker.py'),
};
const options = {
  model: 'configured-model',
  effort: 'low',
  codexPath: null,
  signal: new AbortController().signal,
};
it('runs a task through the shared transport with data and model configuration', async () => {
  const result = await runAIWorker(
    { id: 'task', kind: 'review', context: { attempt: { code: 'return 1' } }, timeoutMs: 1000 },
    options,
    {},
    runtime,
  );
  expect(result).toEqual({ text: 'Summary:\nPython feedback', model: 'configured-model' });
});
it('preserves classified errors and denies unsolicited platform reads', async () => {
  await expect(
    runAIWorker(
      { id: 'task', kind: 'topics', context: { mode: 'usage' }, timeoutMs: 1000 },
      options,
      {},
      runtime,
    ),
  ).rejects.toMatchObject({ kind: 'usage_limit' });
  await expect(
    runAIWorker(
      { id: 'task', kind: 'topics', context: { mode: 'unexpected_read' }, timeoutMs: 1000 },
      options,
      {},
      runtime,
    ),
  ).rejects.toThrow('Unexpected evidence');
});
