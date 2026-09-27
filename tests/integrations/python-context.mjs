// node --import tsx tests/integrations/python-context.mjs [--live]
// Uses a disposable database. --live also uses signed-in Codex account usage.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createApp } from '../../src/server/core/app.ts';
import { LocalApi } from '../../src/integrations/local-api.ts';

const dir = await mkdtemp(join(tmpdir(), 'bloomcode-python-test-'));
const client = new Client({ name: 'tutor-integration', version: '1' });
let app;
try {
  app = await createApp({ dbPath: join(dir, 'leetcode.sqlite') });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  const problem = await api.request('POST', '/api/problems', {
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
  });
  const completed = [];
  for (let i = 0; i < 2; i++) {
    const attempt = await api.request('POST', '/api/attempts', {
      problemId: problem.id,
      context: 'targeted',
    });
    await api.request(
      'POST',
      `/api/attempts/${attempt.id}/finish`,
      {
        version: attempt.version,
        outcome: 'solved',
        help: i ? 'none' : 'small',
        activeSeconds: 300,
        code: '# Test fixture, not an executed solution',
        notes: i ? 'Used a hash map independently' : 'Needed a hint about complements',
        requestReview: false,
      },
      `python-context-${i}`,
    );
    completed.push(attempt.id);
  }
  const active = await api.request('POST', '/api/attempts', {
    problemId: problem.id,
    context: 'targeted',
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve('src/integrations/mcp.ts')],
      env: { ...process.env, DATA_DIR: dir, PORT: new URL(url).port },
      stderr: 'pipe',
    }),
  );
  const tools = (await client.listTools()).tools;
  for (const name of ['get_recent_attempts', 'get_attempt_context']) {
    assert.equal(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, true);
  }
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const data = (result) => {
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const recent = data(await call('get_recent_attempts', { problem: 'two SUM', limit: 1 }));
  assert.equal(recent.attempts[0].id, completed[1]);
  assert.equal(recent.hasMore, true);
  assert.equal('code' in recent.attempts[0], false);
  assert.equal('notes' in recent.attempts[0], false);
  assert.deepEqual(
    data(await call('get_recent_attempts', { problem: 'no matching title' })).attempts,
    [],
  );
  assert.equal(data(await call('get_recent_attempts')).attempts.length, 2); // excludes active
  assert.equal((await call('get_recent_attempts', { limit: 21 })).isError, true);
  const context = data(await call('get_attempt_context', { attemptId: recent.attempts[0].id }));
  assert.equal(context.attempt.notes, 'Used a hash map independently');
  assert.equal(context.history.find((a) => a.id === completed[0]).help, 'small');
  assert.equal((await call('get_attempt_context', { attemptId: 'missing-attempt' })).isError, true);
  console.log('PASS: existing TypeScript MCP discovers, filters, orders and retrieves attempts');

  if (process.argv.includes('--live')) {
    const { stdout } = await promisify(execFile)(
      resolve('python/.venv/bin/python'),
      [
        '-c',
        `
import os
from pathlib import Path
from tutor import open_tutor
with open_tutor(api_url=os.environ['TEST_URL'], token_file=Path(os.environ['TEST_TOKEN'])) as tutor:
    activity = []
    def report(message):
        activity.append(message)
        print('Tutor:', message, flush=True)
    answer = tutor.reply('For my latest Two Sum attempt, what changed in my recorded help usage compared to earlier attempts?', on_activity=report)
    for started, completed in [('Finding recent attempts…', 'Attempt search completed.'),
                               ('Retrieving attempt context…', 'Context retrieval completed.')]:
        assert started in activity and completed in activity, activity
        assert activity.index(started) < activity.index(completed), activity
    assert tutor.session_file.exists()
    print('PASS: Python tutor streamed both tool activities without a supplied ID and saved the conversation')
    print('Tutor:', answer)
    print('Follow-up:', tutor.reply('Which problem were we discussing? Be brief.'))
`,
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: resolve('python'),
          TEST_URL: url,
          TEST_TOKEN: join(dir, 'api-token'),
        },
        timeout: 180_000,
      },
    );
    console.log(stdout.trim());
  }
  await api.request(
    'POST',
    `/api/attempts/${active.id}/cancel`,
    { version: active.version },
    'cancel-test',
  );
  await api.request('POST', '/api/attempts', { problemId: problem.id, context: 'mixed' });
  for (const [name, args] of [
    ['get_recent_attempts', {}],
    ['get_attempt_context', { attemptId: completed[1] }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.status, 403);
  }
  console.log('PASS: both tools respect hidden-assessment restrictions');
} finally {
  await client.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
