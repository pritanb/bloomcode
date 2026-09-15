import { afterEach, expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalApi } from '../../src/integrations/local-api.js';
import { callTool, toolDefinitions } from '../../src/integrations/mcp.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(handler: (method: string, path: string, body: unknown, headers: Record<string, unknown>) => {status?: number; body: unknown}) {
  const dir = await mkdtemp(join(tmpdir(), 'lc-mcp-')); cleanup.push(() => rm(dir, {recursive:true,force:true}));
  await writeFile(join(dir,'api-token'), 'secret-test-token', {mode:0o600});
  const server: Server = createServer(async (req,res) => { let raw=''; for await (const chunk of req) raw+=chunk; const reply=handler(req.method!,req.url!,raw ? JSON.parse(raw) : null,req.headers); res.writeHead(reply.status ?? 200, {'content-type':'application/json'}); res.end(JSON.stringify(reply.body)); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve)); cleanup.push(() => new Promise<void>((resolve,reject) => server.close(e => e?reject(e):resolve())));
  const address=server.address(); if (!address || typeof address === 'string') throw Error('No address');
  return new LocalApi({dataDir:dir,baseUrl:`http://127.0.0.1:${address.port}`});
}
test('MCP refuses to claim verification when read-back identifies another attempt',async()=>{
  const api=await fixture(method=>({body:method==='POST'?{id:'a1',version:4,status:'completed'}:{id:'other',version:4,status:'completed'}}));
  const result=await callTool(api,'finish_attempt',{attemptId:'a1',idempotencyKey:'operation-1',version:3,outcome:'solved',help:'none',activeSeconds:42});
  expect(result.isError).toBe(true);expect(result.content[0]?.text).toContain('COMMITTED_READBACK_MISMATCH');
});
test('get_today forwards a bounded date to the authenticated canonical plan API', async () => {
  const api=await fixture((method,path,body,headers) => { expect(method).toBe('POST'); expect(path).toBe('/api/daily-plan/ensure'); expect(body).toEqual({date:'2026-09-16'}); expect(headers.authorization).toBe('Bearer secret-test-token'); return {body:{id:'plan',items:[]}}; });
  const result=await callTool(api,'get_today',{date:'2026-09-16'});
  expect(result.isError).not.toBe(true); expect(result.content).toEqual([{type:'text',text:JSON.stringify({id:'plan',items:[]})}]);
  expect(toolDefinitions.map(t=>t.name)).toContain('get_today');
});
test('finish_attempt preserves explicit versions and idempotency then reads committed attempt', async () => {
  const requests: string[]=[];
  const api=await fixture((method,path,body,headers) => { requests.push(`${method} ${path}`); if(method==='POST') { expect(headers['idempotency-key']).toBe('operation-1'); expect(body).toEqual({version:3,outcome:'solved',help:'none',activeSeconds:42}); } return {body:{id:'a1',version:4,status:'completed'}}; });
  const result=await callTool(api,'finish_attempt',{attemptId:'a1',idempotencyKey:'operation-1',version:3,outcome:'solved',help:'none',activeSeconds:42});
  expect(result.isError).not.toBe(true);
  expect(requests).toEqual(['POST /api/attempts/a1/finish','GET /api/attempts/a1']);
});
