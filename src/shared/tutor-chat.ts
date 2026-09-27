export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type ChatProposal = {
  kind: 'goal' | 'preferences';
  key: string;
  change: Record<string, unknown>;
};
export type ChatState = {
  status: 'closed' | 'starting' | 'ready' | 'working' | 'error' | 'blocked';
  conversationId?: string;
  messages: ChatMessage[];
  proposals: ChatProposal[];
  activity: string;
  draft: string;
  error: string | null;
  evidence?: { id: string; title: string }[];
};
