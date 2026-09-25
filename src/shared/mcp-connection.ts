import type { TutorProvider } from './tutor.js';
export interface McpConnectionStatus {
  state: 'unknown' | 'connected' | 'disconnected';
  lastSeenAt: string | null;
  sampling: boolean;
  automaticReviews: boolean;
  provider?: TutorProvider;
}
