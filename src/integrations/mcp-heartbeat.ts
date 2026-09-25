import { randomUUID } from 'node:crypto';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { LocalApi } from './local-api.js';

// Independent of sampling: a long model response must not look like a lost client.
export function startMcpHeartbeat(server: Server, api: LocalApi): () => void {
  const id = randomUUID();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try {
      await server.request({ method: 'ping' }, EmptyResultSchema, { timeout: 8000 });
      if (!stopped) await api.request('POST', '/api/mcp/heartbeat', { id, sampling: !!server.getClientCapabilities()?.sampling, automaticReviews: process.env.TUTOR_AUTO_REVIEW !== '0' });
    } catch { /* A missing heartbeat is surfaced by the app; keep trying. */ }
    if (!stopped) timer = setTimeout(() => void tick(), 10_000);
  }
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
