export interface McpConnectionStatus {
  state: 'unknown' | 'connected' | 'disconnected';
  lastSeenAt: string | null;
  sampling: boolean;
  automaticReviews: boolean;
}
