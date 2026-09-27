// node --import tsx tests/integrations/python-context.mjs [--live]
// Uses a disposable database. --live also uses signed-in Codex account usage.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  app = await createApp({
    dbPath: join(dir, 'leetcode.sqlite'),
    embed: async (texts) => texts.map(() => [1, 0]),
  });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  const api = new LocalApi({ dataDir: dir, baseUrl: url });
  await api.request('POST', '/api/import', {
    importId: 'snapshot-topics',
    dryRun: false,
    source: { retrievedAt: '2026-09-27T00:00:00Z' },
    problems: [],
    attempts: [],
    movements: [],
    records: [],
    topics: [
      { name: 'Arrays', score: 3.5, provisional: false, notes: 'Private topic note' },
      { name: 'Stacks', score: 1.5, provisional: true, notes: '' },
      { name: 'Graphs', score: null, provisional: false, notes: '' },
    ],
  });
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
  for (const name of [
    'get_recent_attempts',
    'get_attempt_context',
    'get_learning_insights',
    'get_topic_scores',
    'retrieve_learning_evidence',
  ]) {
    assert.equal(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, true);
  }
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const data = (result) => {
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const scores = data(await call('get_topic_scores', { limit: 1 }));
  assert.equal(scores.total, 3);
  assert.equal(scores.unscoredCount, 1);
  assert.equal(scores.hasMore, true);
  assert.equal(scores.topics[0].name, 'Stacks');
  assert.equal(scores.topics[0].provisional, true);
  assert.equal('notes' in scores.topics[0], false);
  const allScores = data(await call('get_topic_scores'));
  assert.deepEqual(
    allScores.topics.map((t) => t.score),
    [1.5, 3.5, null],
  );
  assert.equal((await call('get_topic_scores', { limit: 51 })).isError, true);
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

  await api.request(
    'POST',
    `/api/attempts/${active.id}/cancel`,
    { version: active.version },
    'cancel-test',
  );

  // A different problem provides conflicting evidence: improvement on Two Sum
  // must not become a claim of independence across all problems.
  const otherProblem = await api.request('POST', '/api/problems', {
    title: 'Valid Parentheses',
    url: 'https://leetcode.com/problems/valid-parentheses/',
  });
  const other = await api.request('POST', '/api/attempts', {
    problemId: otherProblem.id,
    context: 'targeted',
  });
  await api.request(
    'POST',
    `/api/attempts/${other.id}/finish`,
    {
      version: other.version,
      outcome: 'not_solved',
      help: 'major',
      activeSeconds: 600,
      notes: 'Needed help tracking unmatched opening brackets.',
      requestReview: false,
    },
    'python-context-other',
  );
  await api.request('POST', '/api/insights/enable', { enabled: false });
  const insights = data(await call('get_learning_insights'));
  assert.equal(insights.enabled, false);
  assert.equal(insights.report, null);
  assert.deepEqual(
    data(await call('retrieve_learning_evidence', { query: 'stack', limit: 5 })).observations,
    [],
  );
  assert.equal(
    (await call('retrieve_learning_evidence', { query: 'stack', limit: 21 })).isError,
    true,
  );
  console.log('PASS: insight status and bounded evidence search work with sparse history');

  const snapshotConfig = join(dir, 'snapshot.toml');
  await writeFile(
    snapshotConfig,
    [
      '[mcp_servers.bloomcode]',
      `command = ${JSON.stringify(process.execPath)}`,
      `args = ${JSON.stringify(['--import', 'tsx', resolve('src/integrations/mcp.ts')])}`,
      `cwd = ${JSON.stringify(resolve('.'))}`,
      `env.DATA_DIR = ${JSON.stringify(dir)}`,
      `env.PORT = ${JSON.stringify(new URL(url).port)}`,
    ].join('\n'),
  );
  const snapshot = async () => {
    const { stdout } = await promisify(execFile)(
      resolve('python/.venv/bin/python'),
      [
        '-c',
        'import json,sys; from pathlib import Path; from learner_state import load_snapshot; print(json.dumps(load_snapshot(Path(sys.argv[1]))))',
        snapshotConfig,
      ],
      { env: { ...process.env, PYTHONPATH: resolve('python') }, timeout: 30000 },
    );
    return JSON.parse(stdout);
  };
  const state = await snapshot();
  assert.equal(state.status, 'available');
  assert.equal(state.attemptCount, 3);
  assert.equal(state.distinctProblems, 2);
  assert.equal(state.topicScores.status, 'available');
  assert.deepEqual(
    state.topicScores.topics.map((t) => t.score),
    [1.5, 3.5, null],
  );
  assert.deepEqual(state.helpUsage, { major: 1, none: 1, small: 1 });
  assert.deepEqual(state.outcomes, { not_solved: 1, solved: 2 });
  console.log('PASS: Python snapshot computes facts through the real MCP server');

  if (process.argv.includes('--live')) {
    const { stdout } = await promisify(execFile)(
      resolve('python/.venv/bin/python'),
      [
        '-c',
        `
import os
import tomllib
from pathlib import Path
from tutor import open_tutor
with open_tutor(api_url=os.environ['TEST_URL'], token_file=Path(os.environ['TEST_TOKEN'])) as tutor:
    config = tomllib.loads((tutor.session_file.parent / 'codex-home/config.toml').read_text())
    assert set(config['mcp_servers']['bloomcode']['enabled_tools']) == {
        'get_recent_attempts', 'get_attempt_context', 'get_learning_insights', 'retrieve_learning_evidence', 'get_topic_scores', 'get_learning_goals', 'propose_learning_goal'}
    activity = []
    def report(message):
        activity.append(message)
        print('Tutor:', message, flush=True)
    answer = tutor.reply('For my latest Two Sum attempt, what changed in my recorded help usage compared to earlier attempts?', on_activity=report)
    for started, completed in [('Loading learner snapshot…', 'Learner snapshot available.'),
                               ('Retrieving attempt context…', 'Context retrieval completed.')]:
        assert started in activity and completed in activity, activity
        assert activity.index(started) < activity.index(completed), activity
    assert tutor.session_file.exists()
    print('PASS: Python tutor loaded a snapshot and retrieved context without a supplied ID and saved the conversation')
    print('Tutor:', answer)
    print('Follow-up:', tutor.reply('Which problem were we discussing? Be brief.'))
    activity.clear()
    recommendation = tutor.reply('What should I practise next across my recent problems? Explain the evidence and limitations.', on_activity=report)
    assert 'Learning insights completed.' in activity, activity
    assert 'Learner snapshot available.' in activity, activity
    assert 'Context retrieval completed.' in activity, activity
    assert os.environ['TEST_OTHER_ATTEMPT'] in recommendation, recommendation
    print('Practice recommendation:', recommendation)
    print('PASS: broader recommendation uses learning status and cites the other problem despite disabled Insights')
`,
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: resolve('python'),
          TEST_URL: url,
          TEST_TOKEN: join(dir, 'api-token'),
          TEST_OTHER_ATTEMPT: other.id,
        },
        timeout: 180_000,
      },
    );
    console.log(stdout.trim());
  }
  if (process.argv.includes('--live-goals')) {
    const { stdout } = await promisify(execFile)(
      resolve('python/.venv/bin/python'),
      [
        '-c',
        `
import os
from pathlib import Path
from tutor import open_tutor
from learner_state import load_snapshot
options = dict(api_url=os.environ['TEST_URL'], token_file=Path(os.environ['TEST_TOKEN']), new=True)
text = 'Solve two distinct sliding-window problems without hints'
with open_tutor(**options) as tutor:
    print(tutor.reply('Please propose this exact learning goal for me to confirm: ' + text), flush=True)
    assert len(tutor.pending_goals) == 1, tutor.pending_goals
    assert load_snapshot(tutor.context_config)['goals']['goals'] == []
    proposal = tutor.pending_goals[0]
    assert proposal['change'] == {'action': 'create', 'text': text}, proposal
    saved = tutor.confirm_goal(proposal, True)
    assert saved['text'] == text and saved['sourceConversation'] == tutor.thread.id
    first_id = tutor.thread.id
with open_tutor(**options) as tutor:
    assert tutor.thread.id != first_id
    answer = tutor.reply('List the exact text of my saved active learning goal.')
    assert text.lower() in answer.lower(), answer
    print('New conversation:', answer, flush=True)
print('PASS: live proposal stayed unsaved until host confirmation and a fresh conversation recalled it')
`,
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: resolve('python'),
          TEST_URL: url,
          TEST_TOKEN: join(dir, 'api-token'),
        },
        timeout: 180000,
      },
    );
    console.log(stdout.trim());
  }
  await api.request('POST', '/api/attempts', { problemId: problem.id, context: 'mixed' });
  for (const [name, args] of [
    ['get_recent_attempts', {}],
    ['get_topic_scores', {}],
    ['get_learning_goals', {}],
    ['get_attempt_context', { attemptId: completed[1] }],
    ['retrieve_learning_evidence', { query: 'stack', limit: 5 }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error.status, 403);
  }
  const hiddenInsights = data(await call('get_learning_insights'));
  assert.equal(hiddenInsights.hidden, true);
  assert.equal(hiddenInsights.report, null);
  assert.deepEqual(hiddenInsights.observations, []);
  assert.deepEqual(hiddenInsights.suggestions, []);
  const blocked = await snapshot();
  assert.equal(blocked.status, 'blocked');
  assert.equal('attempts' in blocked, false);
  console.log('PASS: learning tools and Python snapshot respect hidden-assessment restrictions');
} finally {
  await client.close();
  if (app) await app.close();
  await rm(dir, { recursive: true, force: true });
}
