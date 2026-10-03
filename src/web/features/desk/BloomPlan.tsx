import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Sparkles } from 'lucide-react';
import type { BloomPlanStatus } from '../../../shared/plan-drafts';
import { api } from '../../app/api';
import { Callout } from '../../components/kit';
import { ErrorNotice, useAction } from '../../components/ui';
import { Button } from '@/components/ui/button';

export type BloomPlanState = { plan: BloomPlanStatus | null; tutorActive: boolean };
const planning = (s?: BloomPlanState) =>
  !!s?.tutorActive && (s.plan?.status === 'pending' || s.plan?.status === 'running');

/** Bloom plans today in the background; refresh the plan when it lands. */
export function useBloomPlan() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['bloom-plan'],
    queryFn: () => api.get<BloomPlanState>('/plan-drafts/today'),
    refetchInterval: (q) => (planning(q.state.data) ? 3000 : 30000),
  });
  const status = query.data?.plan?.status;
  useEffect(() => {
    if (status === 'applied' || status === 'failed')
      void cache.invalidateQueries({ queryKey: ['dashboard'] });
  }, [status, cache]);
  return { ...query, planning: planning(query.data) };
}

/** What Bloom is doing with today's plan: planning, its summary, or why the rules took over. */
export function BloomPlanNote({
  state,
  planId,
  hasItems,
}: {
  state: BloomPlanState | undefined;
  planId: string;
  hasItems: boolean;
}) {
  const replan = useAction(() =>
    api.send<BloomPlanState>('/plan-drafts/today/refresh', 'POST', {}),
  );
  const plan = state?.plan?.planId === planId ? state.plan : null;
  if (!state?.tutorActive || !plan) return null;
  if (plan.status === 'pending' || plan.status === 'running')
    return (
      <div role="status" className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        {hasItems
          ? 'Bloom is re-planning your unstarted questions…'
          : 'Bloom is planning your day…'}
      </div>
    );
  const again = (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      disabled={replan.isPending}
      onClick={() => replan.mutate()}
    >
      <Sparkles aria-hidden="true" />
      {plan.status === 'failed' ? 'Try again' : 'Re-plan'}
    </Button>
  );
  if (plan.status === 'failed')
    return (
      <Callout label="Bloom couldn't plan today" className="text-[0.8125rem]">
        <p className="text-muted-foreground">These are the built-in picks for now.</p>
        {again}
        <ErrorNotice error={replan.error} />
      </Callout>
    );
  if (plan.status !== 'applied' || !plan.summary) return null;
  return (
    <Callout tone="brand" label="Bloom" className="text-[0.8125rem]">
      <p>{plan.summary}</p>
      {again}
      <ErrorNotice error={replan.error} />
    </Callout>
  );
}
