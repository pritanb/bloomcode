import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { TutorJobKind } from '../shared/tutor.js';
import type { LocalApi } from './local-api.js';

// One model call, independent of who runs the model (MCP sampling or Codex CLI).
export interface GenerateRequest { kind: TutorJobKind; system: string; user: string; maxTokens: number; timeoutMs: number }
export type Generate = (request: GenerateRequest) => Promise<{ text: string; model: string | null }>;
export type Api = Pick<LocalApi, 'request'>;

export function samplingGenerate(server: Server): Generate {
  return async ({ system, user, maxTokens, timeoutMs }) => {
    const response = await server.createMessage(
      { systemPrompt: system, messages: [{ role: 'user', content: { type: 'text', text: user } }], maxTokens, includeContext: 'none' },
      { timeout: Math.max(1, Math.min(180_000, timeoutMs)) },
    );
    const blocks = Array.isArray(response.content) ? response.content : [response.content];
    return { text: blocks.map(b => (b.type === 'text' ? b.text : '')).join(''), model: response.model ?? null };
  };
}
