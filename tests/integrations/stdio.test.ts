import { test, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test('stdio SDK client can search, inspect and save a reviewed attempt with a verified follow-up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lc-stdio-'));
  await writeFile(join(dir, 'api-token'), 'stdio-secret');
  const requests: { method: string; path: string; body: unknown; key: unknown }[] = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    requests.push({
      method: req.method!,
      path: req.url!,
      body: text ? JSON.parse(text) : null,
      key: req.headers['idempotency-key'],
    });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/reviews'
          ? [{ id: 'r1', version: 3, action: 'manual', effectiveDate: '2026-09-20' }]
          : req.url === '/api/reviews/r1'
            ? { id: 'r1', version: 3, action: 'manual', effectiveDate: '2026-09-20' }
            : { attempt: { id: 'a1', version: 5 }, decisions: [] },
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('address');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', resolve('src/integrations/mcp.ts')],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ),
      DATA_DIR: dir,
      PORT: String(a.port),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'integration-test', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'confirm_learning_goal',
      'confirm_plan_change',
      'confirm_tutor_preferences',
      'finish_attempt',
      'get_attempt_context',
      'get_learning_goals',
      'get_learning_insights',
      'get_recent_attempts',
      'get_shortlist',
      'get_today',
      'get_today_plan',
      'get_topic_scores',
      'get_training_levels',
      'get_tutor_access',
      'get_tutor_preferences',
      'propose_learning_goal',
      'propose_plan_change',
      'propose_tutor_preferences',
      'retrieve_learning_evidence',
      'save_review',
      'search_questions',
      'set_review_date',
    ]);
    expect(
      (
        await client.callTool({
          name: 'search_questions',
          arguments: { search: 'tree', tags: ['t1', 't2'], tagMode: 'all', pageSize: 10 },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: 'get_attempt_context', arguments: { attemptId: 'a1' } }))
        .isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: 'save_review',
          arguments: {
            attemptId: 'a1',
            version: 4,
            idempotencyKey: 'review-1',
            feedback: 'Retained.',
            decisions: [
              {
                topicId: 't1',
                expectedVersion: 2,
                oldScore: 3.2,
                newScore: 3.2,
                rationale: 'Repeat only.',
                evidence: 'retention',
              },
            ],
          },
        })
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: 'set_review_date',
          arguments: { targetId: 'r1', version: 2, action: 'manual', date: '2026-09-20' },
        })
      ).isError,
    ).not.toBe(true);
    expect(requests.map((r) => r.path)).toEqual([
      '/api/problems?search=tree&tags=t1%2Ct2&tagMode=all&pageSize=10',
      '/api/attempts/a1/context',
      '/api/attempts/a1/reviews',
      '/api/attempts/a1/context',
      '/api/reviews/r1',
      '/api/reviews',
    ]);
    expect(requests[2]?.key).toBe('review-1');
    const count = requests.length;
    expect(
      (await client.callTool({ name: 'search_questions', arguments: { pageSize: 10001 } })).isError,
    ).toBe(true);
    expect(requests).toHaveLength(count);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
