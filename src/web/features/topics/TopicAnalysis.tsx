import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Crosshair, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TopicAnalysisStatus } from '../../../shared/topic-analysis';
import { api } from '../../app/api';
import { Loading } from '../../components/ui';
import { EmptyState, Meter, SectionHeader, Tile, TileGrid, TileTitle } from '../../components/kit';
import { tutorProblem } from '../insights/analysis-status';

/** "Where to focus": the tutor's top topics as tiles on the page background. */
export function TopicAnalysis() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['topic-analysis'],
    queryFn: () => api.get<TopicAnalysisStatus>('/topics/analysis'),
    refetchInterval: 5000,
  });
  const action = useMutation({
    mutationFn: () => api.send('/topics/analysis/retry', 'POST', {}),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['topic-analysis'] });
    },
  });
  const data = query.data;
  const topics = (data?.report?.topicIds ?? []).flatMap((id, i) => {
    const topic = data?.topics.find((t) => t.id === id);
    return topic ? [{ ...topic, reason: data?.report?.reasons?.[i] }] : [];
  });
  const updating = data?.enabled && (data.status === 'pending' || data.status === 'running');
  const problem = tutorProblem(data?.runner);
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <SectionHeader
        title="Where to focus"
        icon={Crosshair}
        tone="brand"
        actions={
          data &&
          !data.hidden && (
            <Button
              variant="outline"
              className="text-foreground"
              disabled={action.isPending || !!updating || !data.topics.length}
              onClick={() => action.mutate()}
            >
              {updating || action.isPending
                ? 'Refreshing…'
                : topics.length
                  ? 'Refresh'
                  : 'Generate recommendations'}
            </Button>
          )
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <div className="flex flex-wrap items-center gap-3 text-[0.9375rem]">
          <p>Couldn’t load your recommendations.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : data?.hidden ? (
        <EmptyState
          icon={Lock}
          className="py-8"
          title="Recommendations unlock after your assessment"
          description="Finish your mixed assessment to see topic recommendations."
        />
      ) : (
        <>
          {(problem || updating || data?.status === 'failed' || !data?.topics.length) && (
            <p className="-mt-1 text-[0.8125rem] text-muted-foreground" role="status">
              {problem
                ? `${problem.title}. ${problem.detail}`
                : data?.status === 'failed'
                  ? 'Couldn’t refresh. Try again.'
                  : updating
                    ? 'Updating your focus topics…'
                    : 'Add topics to get recommendations.'}
            </p>
          )}
          {topics.length > 0 && (
            <TileGrid
              min="14rem"
              role="list"
              aria-label="Priority topics"
              className="grid-cols-[repeat(auto-fit,minmax(min(100%,var(--tile-min)),1fr))]"
            >
              {topics.map((topic, i) => (
                <div role="listitem" key={topic.id} className="flex">
                  <Tile asChild className="group flex-1">
                    <Link
                      to={`/topics/${topic.id}`}
                      aria-label={`Priority ${i + 1}: ${topic.name}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-lg text-[0.8125rem] font-semibold tabular-nums',
                            i === 0
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground',
                          )}
                        >
                          {i + 1}
                        </span>
                        <h3 className="min-w-0">
                          <TileTitle>{topic.name}</TileTitle>
                        </h3>
                      </span>
                      <span className="mt-auto flex flex-col gap-3">
                        <span className="flex items-baseline justify-between gap-3">
                          {topic.score === null ? (
                            <span className="text-[0.9375rem] leading-7 text-muted-foreground">
                              Not yet assessed
                            </span>
                          ) : (
                            <span className="flex items-baseline gap-1 tabular-nums">
                              <strong className="text-[1.75rem] leading-none font-semibold tracking-[-0.035em]">
                                {topic.score.toFixed(1)}
                              </strong>
                              <span className="leading-none font-medium text-muted-foreground">
                                / 5
                              </span>
                            </span>
                          )}
                          <span
                            className={cn(
                              'inline-flex shrink-0 items-center gap-1 text-[0.8125rem] leading-none font-medium group-hover:text-brand-text [&>svg]:size-3.5',
                              i === 0 ? 'text-brand-text' : 'text-muted-foreground',
                            )}
                          >
                            View topic <ArrowRight aria-hidden="true" />
                          </span>
                        </span>
                        <Meter
                          value={topic.score ?? 0}
                          max={5}
                          label={`${topic.name} score`}
                          valueText={
                            topic.score === null ? 'Not yet assessed' : `${topic.score} of 5`
                          }
                        />
                      </span>
                      {topic.reason && (
                        <span
                          className="line-clamp-2 text-[0.875rem] leading-relaxed text-muted-foreground"
                          title={topic.reason}
                        >
                          {topic.reason}
                        </span>
                      )}
                    </Link>
                  </Tile>
                </div>
              ))}
            </TileGrid>
          )}
          {action.isError && (
            <p role="alert" className="text-[0.9375rem]">
              Couldn’t start the refresh. Please try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
