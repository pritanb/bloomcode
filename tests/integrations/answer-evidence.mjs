// Disposable study data and real MCP transport. --live additionally uses Codex allowance.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server/core/app.ts';
import { LocalApi } from '../../src/integrations/local-api.ts';

const dir = await mkdtemp(join(tmpdir(), 'bloom-answer-'));
const app = await createApp({
  dbPath: join(dir, 'study.sqlite'),
  embed: async (texts) => texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
});
try {
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  const ids = [];
  for (const [slug, title, notes, outcome, help] of [
    [
      'binary-search',
      'Binary Search',
      'I solved basic Binary Search independently and explained why the search interval contains the target.',
      'solved',
      'none',
    ],
    [
      'search-insert-position',
      'Search Insert Position',
      'I struggled with Binary Search boundaries when the target was absent. I could not decide whether right should be mid or mid minus one.',
      'not_solved',
      'major',
    ],
    [
      'search-in-rotated-sorted-array',
      'Search in Rotated Sorted Array',
      'I needed a hint to identify which half was sorted before deciding which side to discard in Binary Search.',
      'solved',
      'small',
    ],
  ]) {
    const p = await api.request('POST', '/api/problems', {
      title,
      url: `https://leetcode.com/problems/${slug}/`,
    });
    const a = await api.request('POST', '/api/attempts', { problemId: p.id, context: 'targeted' });
    await api.request(
      'POST',
      `/api/attempts/${a.id}/finish`,
      {
        version: a.version,
        outcome,
        help,
        notes,
        code: '# Synthetic fixture; no executable solution recorded.',
        activeSeconds: 600,
        requestReview: false,
      },
      slug,
    );
    ids.push(a.id);
  }
  await api.request('POST', '/api/insights/enable', { enabled: true });
  const service = app.tutorJobs.insights;
  for (let i = 0; i < 3; i++) {
    const work = service.claim();
    assert.ok(work?.job.attemptId);
    const notes = work.context.notes;
    service.complete(
      work.job.id,
      work.job.claimId,
      {
        observations: [
          {
            summary: notes,
            polarity: work.job.attemptId === ids[0] ? 'strength' : 'difficulty',
            evidenceType: 'learner_reported',
            sourceField: 'notes',
            excerpt: notes,
          },
        ],
        limitation: 'Synthetic notes only; no executed code.',
      },
      'fixture',
    );
  }
  await service.refresh();
  assert.equal(service.embeddingStatus, 'ready');
  const restricted = join(dir, 'restricted');
  await mkdir(restricted);
  await writeFile(join(restricted, 'api-token'), await readFile(join(dir, 'tutor-token')), {
    mode: 0o600,
  });
  const config = join(dir, 'mcp.toml');
  await writeFile(
    config,
    [
      '[mcp_servers.bloomcode]',
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify(['--import', 'tsx', resolve('src/integrations/mcp.ts')])}`,
      `cwd = ${JSON.stringify(resolve('.'))}`,
      `env.DATA_DIR = ${JSON.stringify(restricted)}`,
      `env.PORT = ${JSON.stringify(new URL(url).port)}`,
    ].join('\n'),
  );
  const run = async (script, extra = []) => {
    const result = await promisify(execFile)(
      resolve('python/.venv/bin/python'),
      [...script, ...extra],
      {
        env: { ...process.env, PYTHONPATH: resolve('python') },
        timeout: 240000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return result.stdout;
  };
  const inspect = async () =>
    JSON.parse(
      await run([
        '-c',
        `
import json,sys
from pathlib import Path
from bloom_tutor.answer_graph import AnswerFlow
flow = AnswerFlow(Path(sys.argv[1]), lambda message, **kw: 'inspected')
flow.reply('Why am I still failing to understand Binary Search questions?')
print(json.dumps(flow.last_evidence))
`,
        config,
      ]),
    );
  let bundle = await inspect();
  assert.equal(bundle.status, 'available');
  assert.equal(bundle.attempts.length, 3);
  assert.deepEqual(
    new Set(bundle.observations.map((o) => o.polarity)),
    new Set(['strength', 'difficulty']),
  );
  console.log(
    'PASS: LangGraph retrieved both polarities and inspected source attempts through MCP',
  );
  if (process.argv.includes('--live')) {
    const output = resolve('private/answer-evals', new Date().toISOString().replaceAll(':', '-'));
    console.log(
      await run([
        'python/evals/evaluate_answers.py',
        '--api-url',
        url,
        '--token-file',
        join(dir, 'api-token'),
        '--output',
        output,
      ]),
    );
    console.log('Saved comparison:', output);
  }
  const rejected = bundle.observations.find((o) => o.polarity === 'difficulty');
  await api.request('POST', `/api/insights/observations/${rejected.id}/dismiss`, {
    reason: 'Synthetic correction',
  });
  bundle = await inspect();
  assert.ok(!bundle.observations.some((o) => o.id === rejected.id));
  await api.request('POST', '/api/insights/enable', { enabled: false });
  assert.equal((await inspect()).status, 'unavailable');
  const p = await api.request('POST', '/api/problems', {
    title: 'Active',
    url: 'https://leetcode.com/problems/active/',
  });
  await api.request('POST', '/api/attempts', { problemId: p.id, context: 'mixed' });
  await assert.rejects(inspect, /PermissionError/);
  console.log('PASS: corrections, disabled Insights and active-practice restrictions');
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
