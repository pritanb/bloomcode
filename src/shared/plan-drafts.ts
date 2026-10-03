/** Bloom planning today's questions. "superseded": the built-in rules took over. */
export interface BloomPlanStatus {
  planId: string;
  status: 'pending' | 'running' | 'applied' | 'failed' | 'superseded';
  summary: string | null;
  error: string | null;
}
