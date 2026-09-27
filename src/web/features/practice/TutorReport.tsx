import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Attempt, AutoReviewStatus } from '../../../shared/contracts';
import { api } from '../../app/api';
import { cn } from '@/lib/utils';
const working = (s?: AutoReviewStatus['status']) => s === 'pending' || s === 'generating';
/** The tutor report for a finished attempt: shown once saved, with progress while the connected tutor writes it. */
export function TutorReport({ attempt, onReady }: { attempt: Attempt; onReady: () => void }) {
  const cache = useQueryClient();
  const key = ['auto-review', attempt.id];
  const status = useQuery({
    queryKey: key,
    queryFn: () => api.get<AutoReviewStatus>(`/attempts/${attempt.id}/auto-review`),
    enabled: !attempt.feedback,
    refetchInterval: (q) => (working(q.state.data?.status) ? 3000 : false),
  });
  const request = useMutation({
    mutationFn: () => api.send<AutoReviewStatus>(`/attempts/${attempt.id}/auto-review`, 'POST', {}),
    onSuccess: (data) => cache.setQueryData(key, data),
  });
  const state = status.data?.status;
  useEffect(() => {
    if (state === 'done' && !attempt.feedback) onReady();
  }, [state, attempt.feedback, onReady]);
  if (attempt.feedback)
    return (
      <div className="text-[0.9375rem] leading-[1.7] whitespace-pre-wrap wrap-anywhere">
        {attempt.feedback}
      </div>
    );
  if (working(state))
    return (
      <p className="text-[0.9375rem] text-muted-foreground" role="status">
        {state === 'generating'
          ? 'Your tutor is writing a report on this attempt…'
          : status.data?.tutorConnected
            ? 'Queued for your tutor…'
            : 'Your attempt is saved. The AI tutor is off or paused (Settings → AI tutor), so no report is being written yet. You can keep practising without one.'}
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-3">
      <p
        className={cn(
          'text-[0.9375rem]',
          state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {state === 'failed'
          ? `The tutor could not write a report: ${status.data?.error ?? 'unknown error'}`
          : 'No tutor report for this attempt yet.'}
      </p>
      <Button variant="outline" disabled={request.isPending} onClick={() => request.mutate()}>
        <RefreshCw aria-hidden="true" focusable="false" />
        {state === 'failed' ? 'Try again' : 'Ask tutor for a report'}
      </Button>
    </div>
  );
}
