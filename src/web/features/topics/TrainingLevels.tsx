import { useQuery } from '@tanstack/react-query';
import { Mountain } from 'lucide-react';
import { api } from '../../app/api';
import { Panel, ScrollRegion, ToneBadge } from '../../components/kit';
import { ErrorNotice, Loading } from '../../components/ui';
import { cn } from '@/lib/utils';

export type TrainingLevelsData = {
  target: number;
  levels: {
    topic: string;
    level: number;
    atTarget: boolean;
    attempts: number;
    lastChange: {
      delta: number;
      problem: string;
      rating: number;
      estimated: boolean;
      result: 'strong' | 'ok' | 'struggled';
    } | null;
  }[];
};
const FLOOR = 1000;

/** Each topic's level on the problem-rating scale, toward the target Bloom trains to. */
export function TrainingLevels({ className }: { className?: string }) {
  const query = useQuery({
    queryKey: ['training-levels'],
    queryFn: () => api.get<TrainingLevelsData>('/training-levels'),
  });
  return (
    <Panel
      title="Training levels"
      icon={Mountain}
      meta={query.data ? `Target ${query.data.target.toLocaleString()}` : undefined}
      className={cn('min-h-0', className)}
    >
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <ScrollRegion className="-mx-1 px-1">
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">
            Each attempt counts as Strong, OK or Struggled (outcome, help, time, first-try
            acceptance and confidence) and moves that topic's level. Bloom plans around them.
          </p>
          <ul className="m-0 grid list-none gap-x-6 gap-y-3 p-0 md:grid-cols-2">
            {query.data.levels.map((l) => {
              const progress = Math.min(
                100,
                Math.max(0, ((l.level - FLOOR) / (query.data.target - FLOOR)) * 100),
              );
              return (
                <li key={l.topic} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.875rem] font-medium">{l.topic}</span>
                    <span className="flex items-center gap-1.5 text-[0.8125rem] tabular-nums">
                      {l.atTarget ? (
                        <ToneBadge tone="emerald">At target</ToneBadge>
                      ) : l.lastChange?.result === 'struggled' ? (
                        <ToneBadge tone="amber">Last: struggled</ToneBadge>
                      ) : null}
                      {l.level.toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${l.topic} level`}
                    aria-valuemin={FLOOR}
                    aria-valuemax={query.data.target}
                    aria-valuenow={l.level}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="truncate text-[0.75rem] text-muted-foreground">
                    {l.lastChange
                      ? `${l.lastChange.delta >= 0 ? '+' : ''}${l.lastChange.delta} after ${l.lastChange.problem} (${l.lastChange.estimated ? '≈' : ''}${l.lastChange.rating})`
                      : 'Not practised yet'}
                  </span>
                </li>
              );
            })}
          </ul>
        </ScrollRegion>
      )}
    </Panel>
  );
}
