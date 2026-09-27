import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  ListChecks,
  Lock,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActivityDay, WeeklyRecap as Recap } from '../../../shared/contracts';
import { api } from '../../app/api';
import { dateLabel, ErrorNotice, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  List,
  ListRow,
  PageHeader,
  ScrollRegion,
  Panel,
  StatTile,
} from '../../components/kit';
import { enumLabel, helpLabel } from '../../lib/labels';
import { ActivityFigures, ActivityStrip } from './ActivityStrip';
import { statRow, statTile } from './stat-row';

function shiftWeek(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function CompletedAttempts({ recap }: { recap: Recap }) {
  return recap.attempts.length ? (
    <List>
      {recap.attempts.map((attempt) => {
        const solved = attempt.outcome === 'solved';
        return (
          <ListRow
            key={attempt.id}
            icon={solved ? Check : RotateCcw}
            tone={solved ? 'emerald' : 'rose'}
            title={attempt.problem.title}
            to={`/attempts/${attempt.id}`}
            meta={
              <span className="tabular-nums">
                {dateLabel(attempt.studyDate)} · {enumLabel(attempt.outcome)} ·{' '}
                {helpLabel(attempt.help)}
                {attempt.scheduledReview ? ' · Scheduled review' : ''}
              </span>
            }
          />
        );
      })}
    </List>
  ) : (
    <EmptyState
      icon={ListChecks}
      title="No completed attempts"
      description="No completed attempts this week yet."
    />
  );
}

function ScoreChanges({ recap }: { recap: Recap }) {
  return recap.movements.length ? (
    <List>
      {recap.movements.map((movement) => {
        const up = movement.newScore >= movement.oldScore;
        return (
          <ListRow
            key={movement.id}
            icon={up ? TrendingUp : TrendingDown}
            tone={up ? 'emerald' : 'rose'}
            title={`${movement.topicName}: ${movement.oldScore} → ${movement.newScore}`}
            to={
              movement.attemptId ? `/attempts/${movement.attemptId}` : `/topics/${movement.topicId}`
            }
            meta={dateLabel(movement.date)}
          />
        );
      })}
    </List>
  ) : (
    <EmptyState
      icon={TrendingUp}
      title="No score changes"
      description="No recorded score changes this week."
    />
  );
}

export function WeeklyRecap({ activity }: { activity: ActivityDay[] }) {
  const [week, setWeek] = useState('');
  const mountId = useId();
  const query = useQuery({
    queryKey: ['recap', mountId, week],
    gcTime: 0,
    staleTime: 0,
    queryFn: () => api.get<Recap>(`/recap${week ? `?week=${week}` : ''}`),
  });
  const recap = query.data;
  const loading = query.isPending || query.isFetching;
  const ready = !loading && !query.isError && recap ? recap : undefined;
  const status = loading ? (
    <Loading />
  ) : query.isError ? (
    <ErrorNotice error={query.error} retry={() => void query.refetch()} />
  ) : null;

  const pending = <span className="text-muted-foreground">–</span>;
  const activeDays = activity.filter((day) => day.completedAttempts > 0).length;
  const attempts28 = activity.reduce((sum, day) => sum + day.completedAttempts, 0);
  return (
    <>
      <PageHeader
        title="Weekly report"
        description={
          recap
            ? `${week ? 'Week in review' : 'This week'} · ${dateLabel(recap.weekStart)} – ${dateLabel(recap.weekEnd)} · ${recap.timezone}`
            : week
              ? 'Week in review'
              : 'This week'
        }
        actions={
          <>
            {week && (
              <Button variant="ghost" size="sm" onClick={() => setWeek('')}>
                Current week
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              disabled={!recap}
              onClick={() => recap && setWeek(shiftWeek(recap.weekStart, -7))}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              disabled={!recap}
              onClick={() => recap && setWeek(shiftWeek(recap.weekStart, 7))}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </>
        }
      />
      <FillPage>
        <div className={statRow}>
          <StatTile
            className={statTile}
            label="Questions practised"
            icon={BookOpenCheck}
            tone="sky"
            value={ready?.distinctQuestions ?? pending}
            sub={ready ? 'Distinct questions' : ' '}
          />
          <StatTile
            className={statTile}
            label="Independent solves"
            icon={Sparkles}
            tone="emerald"
            value={ready?.independentSolves ?? pending}
            sub={
              ready ? (
                <>
                  <span>
                    <span className="font-medium text-up">No help</span> used
                  </span>
                </>
              ) : (
                ' '
              )
            }
          />
          <StatTile
            className={statTile}
            label="Completed attempts"
            icon={ListChecks}
            tone="solid"
            value={ready?.completedAttempts ?? pending}
            sub={ready ? 'Finished this week' : ' '}
          />
          <StatTile
            className={statTile}
            label="Scheduled reviews"
            icon={CalendarCheck}
            tone="amber"
            value={ready?.scheduledReviews ?? pending}
            sub={ready ? 'Completed from your plan' : ' '}
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          {/* Short windows scroll the column; tall ones let the score list fill and scroll. */}
          <ScrollRegion className="flex flex-col gap-4 xl:*:shrink">
            <Panel title="Last 28 days" icon={CalendarDays} meta="Completed attempts">
              <ActivityFigures
                items={[
                  [activeDays, 'active days'],
                  [attempts28, 'completed attempts'],
                ]}
              />
              <ActivityStrip activity={activity} />
            </Panel>
            <Panel
              title="Recorded score changes"
              icon={TrendingUp}
              meta={ready && !ready.detailsHidden ? ready.movements.length : undefined}
              scroll
              className="gap-2 xl:flex-1"
              bodyClassName="gap-3"
            >
              {status ??
                (recap &&
                  (recap.detailsHidden ? (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      Available after your mixed practice.
                    </p>
                  ) : (
                    <ScoreChanges recap={recap} />
                  )))}
            </Panel>
          </ScrollRegion>
          <Panel
            title={recap?.detailsHidden ? 'Supporting records' : 'Completed attempts'}
            icon={History}
            meta={ready && !ready.detailsHidden ? ready.attempts.length : undefined}
            scroll
            className="min-h-0 gap-2"
            bodyClassName="gap-3"
          >
            {status ??
              (recap &&
                (recap.detailsHidden ? (
                  <EmptyState
                    icon={Lock}
                    title="Supporting records are locked"
                    description="Finish your mixed practice to see supporting records and score changes."
                  />
                ) : (
                  <>
                    <CompletedAttempts recap={recap} />
                    <p className="mt-auto border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                      Independent solves used no help. Scheduled reviews count attempts linked to a
                      scheduled review in a daily plan; unlinked historical reviews are excluded.
                      Weeks use the study date saved with each attempt.
                    </p>
                  </>
                )))}
          </Panel>
        </div>
      </FillPage>
    </>
  );
}
