import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, ChartLine, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SelectField, SelectOption } from '@/components/select-field';
import type { Topic, TopicScoreHistory } from '../../../shared/contracts';
import { api } from '../../app/api';
import { dateLabel, ErrorNotice, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  IconTile,
  List,
  ListRow,
  Panel,
  ScrollRegion,
} from '../../components/kit';
import { TopicAnalysis } from './TopicAnalysis';
import { TrainingLevels } from './TrainingLevels';
import { topicHistory } from './topic-history';

const axisDate = (time: number) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    time,
  );
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;

function Figure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <strong
        className={cn(
          'text-[1.75rem] leading-none font-semibold tracking-[-0.035em] tabular-nums',
          className,
        )}
      >
        {children}
      </strong>
    </div>
  );
}

export function TopicProgress({ topics }: { topics: Topic[] }) {
  const selectId = useId();
  const [selected, setSelected] = useState('');
  const [showAll, setShowAll] = useState(false);
  const fallback = [...topics].sort(
    (a, b) =>
      (b.lastMovement?.date ?? '').localeCompare(a.lastMovement?.date ?? '') ||
      a.name.localeCompare(b.name),
  )[0];
  const topic = topics.find((t) => t.id === selected) ?? fallback;
  const query = useQuery({
    queryKey: ['topic-history', topic?.id],
    queryFn: () => api.get<TopicScoreHistory>(`/topics/${topic!.id}/history`),
    enabled: !!topic,
  });
  // No topic scores yet (a fresh workspace): the training ladder is the whole story.
  if (!topic)
    return (
      <FillPage>
        <TrainingLevels className="flex-1" />
      </FillPage>
    );
  const { ordered, points } = topicHistory(query.data?.decisions ?? []);
  const latest = ordered.at(-1);
  const change = latest ? Math.round((latest.newScore - latest.oldScore) * 100) / 100 : null;
  const current = query.data?.topic ?? topic;
  const rows = [...ordered].reverse();
  return (
    <FillPage>
      <TopicAnalysis />
      <TrainingLevels className="shrink-0 lg:max-h-72" />
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:grid-rows-[minmax(0,1fr)] [&>:only-child]:col-span-full">
        <Panel
          title="Score over time"
          icon={ChartLine}
          className="min-h-0"
          actions={
            <>
              <Label id={`${selectId}-label`} htmlFor={`${selectId}-control`} className="sr-only">
                Topic
              </Label>
              <SelectField
                id={`${selectId}-control`}
                aria-labelledby={`${selectId}-label`}
                className="w-44 text-foreground"
                value={topic.id}
                onValueChange={(id) => {
                  setSelected(id);
                  setShowAll(false);
                }}
              >
                {[...topics]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <SelectOption key={t.id} value={t.id}>
                      {t.name}
                    </SelectOption>
                  ))}
              </SelectField>
            </>
          }
        >
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            {query.isSuccess && (
              <>
                <Figure label="Current score">
                  {current.score ?? 'Unrated'}
                  {current.score !== null && (
                    <span className="ml-1 text-base leading-none font-medium tracking-normal text-muted-foreground">
                      / 5
                    </span>
                  )}
                </Figure>
                <Figure
                  label="Latest change"
                  className={change ? (change > 0 ? 'text-up' : 'text-warn') : undefined}
                >
                  {change === null ? '—' : change === 0 ? 'No change' : signed(change)}
                </Figure>
              </>
            )}
            <Button asChild variant="outline" className="ml-auto">
              <Link to={`/topics/${topic.id}`}>
                View topic details
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {query.isPending ? (
            <Loading />
          ) : query.isError ? (
            <ErrorNotice error={query.error} retry={() => void query.refetch()} />
          ) : (
            <>
              {points.length ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <ChartContainer
                    config={{ score: { label: 'Score', color: 'var(--primary)' } }}
                    className="-mx-1 aspect-auto h-72 w-full tabular-nums lg:h-auto lg:min-h-28 lg:flex-1"
                    aria-label={`${topic.name} score history on a 1 to 5 scale`}
                  >
                    <LineChart
                      data={points}
                      accessibilityLayer
                      margin={{ top: 12, right: 24, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="time"
                        type="number"
                        scale="time"
                        domain={
                          points.length === 1
                            ? [points[0].time - 86400000, points[0].time + 86400000]
                            : ['dataMin', 'dataMax']
                        }
                        ticks={points.length === 1 ? [points[0].time] : undefined}
                        tickFormatter={axisDate}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={45}
                        tickMargin={12}
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                      />
                      <YAxis
                        domain={[1, 5]}
                        ticks={[1, 2, 3, 4, 5]}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                        tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_label, payload) =>
                              dateLabel(payload[0]?.payload.date)
                            }
                          />
                        }
                      />
                      <Line
                        dataKey="score"
                        type="stepAfter"
                        stroke="var(--color-score)"
                        strokeWidth={2.25}
                        dot={{
                          r: 3.5,
                          fill: 'var(--card)',
                          stroke: 'var(--color-score)',
                          strokeWidth: 2,
                        }}
                        activeDot={{
                          r: 5,
                          fill: 'var(--color-score)',
                          stroke: 'var(--card)',
                          strokeWidth: 2,
                        }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ChartContainer>
                  <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {points.length === 1
                      ? 'One recorded review so far.'
                      : `${dateLabel(points[0].date)} – ${dateLabel(points.at(-1)!.date)}.`}{' '}
                    Each point is that day’s final score.
                  </p>
                </div>
              ) : (
                <EmptyState
                  icon={ChartLine}
                  className="min-h-0 flex-1 py-5"
                  title="No dated score history yet"
                  description="Future score reviews will appear here."
                />
              )}
            </>
          )}
        </Panel>
        {query.isSuccess && rows.length > 0 && (
          <Panel
            title="Score updates"
            meta={`${rows.length} ${rows.length === 1 ? 'review' : 'reviews'}`}
            className="min-h-0 gap-2"
          >
            <ScrollRegion>
              <List>
                {(showAll ? rows : rows.slice(0, 5)).map((d) => {
                  const delta = Math.round((d.newScore - d.oldScore) * 100) / 100;
                  return (
                    <ListRow
                      key={d.id}
                      leading={
                        <IconTile
                          size="sm"
                          className="mt-0.5"
                          icon={delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus}
                          tone={delta > 0 ? 'emerald' : delta < 0 ? 'rose' : 'neutral'}
                        />
                      }
                      className="py-3"
                      title={
                        <span className="tabular-nums">
                          {d.oldScore === d.newScore ? d.newScore : `${d.oldScore} → ${d.newScore}`}
                        </span>
                      }
                      meta={dateLabel(d.date)}
                      trailing={
                        <span
                          className={
                            delta === 0
                              ? undefined
                              : delta > 0
                                ? 'font-medium text-up'
                                : 'font-medium text-warn'
                          }
                        >
                          {delta === 0 ? 'No change' : signed(delta)}
                        </span>
                      }
                    />
                  );
                })}
              </List>
            </ScrollRegion>
            {rows.length > 5 && (
              <Button
                variant="ghost"
                className="-ml-2 self-start text-muted-foreground hover:text-foreground"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll ? 'Show fewer updates' : `Show all ${rows.length} updates`}
              </Button>
            )}
          </Panel>
        )}
      </div>
    </FillPage>
  );
}
