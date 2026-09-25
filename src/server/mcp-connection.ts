import type { McpConnectionStatus } from '../shared/mcp-connection.js';

export class McpConnection {
  private clients = new Map<string, { at: number; sampling: boolean; automaticReviews: boolean }>();
  constructor(private clock: () => Date) {}
  heartbeat(id: string, sampling: boolean, automaticReviews: boolean) {
    const now = this.clock().getTime();
    for (const [key, value] of this.clients) if (now - value.at > 300_000) this.clients.delete(key);
    this.clients.set(id, { at: now, sampling, automaticReviews });
  }
  status(): McpConnectionStatus {
    const clients = [...this.clients.values()];
    const active = clients.filter((c) => this.clock().getTime() - c.at < 45_000);
    const latest = clients.length ? Math.max(...clients.map((c) => c.at)) : null;
    return {
      state: active.length ? 'connected' : latest === null ? 'unknown' : 'disconnected',
      lastSeenAt: latest === null ? null : new Date(latest).toISOString(),
      sampling: active.some((c) => c.sampling),
      automaticReviews: active.some((c) => c.sampling && c.automaticReviews),
    };
  }
}
