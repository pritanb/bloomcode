export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type ChatProposal = {
  kind: 'goal' | 'preferences' | 'plan';
  key: string;
  change: Record<string, unknown>;
};
export type ChatState = {
  status: 'closed' | 'starting' | 'ready' | 'working' | 'error' | 'blocked';
  conversationId?: string;
  coaching?: {
    id: string;
    attemptId: string;
    status: 'active' | 'paused' | 'completed';
    needsRetry: boolean;
  } | null;
  coachingError?: string | null;
  messages: ChatMessage[];
  proposals: ChatProposal[];
  activity: string;
  draft: string;
  error: string | null;
  evidence?: { id: string; title: string }[];
};
