import { test, expect } from 'vitest';
import { callTool, toolDefinitions } from '../../src/integrations/mcp.js';
import type { LocalApi } from '../../src/integrations/local-api.js';
function stub(attempt: Record<string, unknown>) {
  return { request: async () => attempt } as unknown as LocalApi;
}
function payload(result: Awaited<ReturnType<typeof callTool>>) {
  return JSON.parse(result.content[0]!.text) as { reviewPending?: boolean; nextStep?: string };
}
const finish = { attemptId: 'a1', idempotencyKey: 'finish-1', version: 2, outcome: 'solved', help: 'none', activeSeconds: 600 };
test('finishing an attempt with no tutor note asks the tutor to write one', async () => {
  const result = await callTool(stub({ id: 'a1', version: 3, feedback: null }), 'finish_attempt', finish);
  expect(result.isError).not.toBe(true);
  const body = payload(result);
  expect(body.reviewPending).toBe(true);
  expect(body.nextStep).toContain('save_review');
});
test('an attempt that already carries a note is not flagged again', async () => {
  const body = payload(await callTool(stub({ id: 'a1', version: 3, feedback: 'Clean one-pass solution.' }), 'finish_attempt', finish));
  expect(body.reviewPending).toBeUndefined();
  expect(body.nextStep).toBeUndefined();
});
test('the finish and review tools tell the tutor a note belongs on every attempt', () => {
  const described = Object.fromEntries(toolDefinitions.map(tool => [tool.name, tool.description]));
  expect(described.finish_attempt).toContain('save_review');
  expect(described.save_review).toContain('EVERY finished attempt');
});
