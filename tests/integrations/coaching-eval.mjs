import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.ts';
import { LocalApi } from '../../src/integrations/local-api.ts';
const dir = await mkdtemp(join(tmpdir(), 'bloom-coaching-'));
const app = await createApp({
  dbPath: join(dir, 'study.sqlite'),
  serveStatic: true,
  embed: async (ts) => ts.map(() => [1, 0]),
});
const url = await app.listen({ port: 0, host: '127.0.0.1' });
const api = new LocalApi({ dataDir: dir, baseUrl: url });
const p = await api.request('POST', '/api/problems', {
  title: 'Longest Substring Without Repeating Characters',
  url: 'https://leetcode.com/problems/longest-substring-without-repeating-characters/',
});
const ids = [];
for (const help of ['small', 'none']) {
  const a = await api.request('POST', '/api/attempts', { problemId: p.id, context: 'targeted' });
  await api.request(
    'POST',
    `/api/attempts/${a.id}/finish`,
    {
      version: a.version,
      outcome: 'solved',
      help,
      activeSeconds: 600,
      code: 'def length(s):\n    seen = set()\n    left = best = 0\n    for right, ch in enumerate(s):\n        while ch in seen:\n            seen.remove(s[left])\n            left += 1\n        seen.add(ch)\n        best = max(best, right-left+1)\n    return best',
      notes:
        help === 'small'
          ? 'Needed a hint to shrink until the duplicate was removed.'
          : 'Solved independently but unsure why a while loop is necessary.',
      requestReview: false,
    },
    'coaching-' + help,
  );
  ids.push(a.id);
}
const cases =
  process.argv.find((a) => a.startsWith('--cases='))?.slice(8) ??
  'diagnostic,correct-answer,direct-explanation';
const output = resolve('private/coaching-evals', new Date().toISOString().replaceAll(':', '-'));
try {
  const code = await new Promise((done, reject) => {
    const child = spawn(
      resolve('python/.venv/bin/python'),
      [
        'python/evaluate_coaching.py',
        '--api-url',
        url,
        '--token-file',
        join(dir, 'api-token'),
        '--output',
        output,
        '--known-attempts',
        ids.join(','),
        '--cases',
        cases,
      ],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', done);
  });
  console.log('Comparison saved:', output);
  process.exitCode = code ?? 1;
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
