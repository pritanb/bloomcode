import { useTutor } from '../tutor/TutorDock';
import { BloomPlanNote, useBloomPlan } from './BloomPlan';
import { DifficultyButtons } from '../practice/AttemptSignals';
import { RatingChip } from '../../components/rating-chip';
import { DropdownMenu } from 'radix-ui';
import { enumLabel } from '../../lib/labels';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CirclePlay,
  Flame,
  History,
  ListChecks,
  Play,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type {
  ActivityDay,
  Attempt,
  Dashboard as DashboardData,
  DailyPlan,
  PlanItem,
  ReviewTarget,
  WeeklyRecap as Recap,
} from '../../../shared/contracts';
import { api } from '../../app/api';
import { ReviewCalendar, reviewWeek } from '../reports/ReviewCalendar';
import { ActivityFigures, ActivityStrip } from '../reports/ActivityStrip';
import { dateLabel, duration, ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import {
  Callout,
  EmptyState,
  FillPage,
  List,
  ListRow,
  Meter,
  PageHeader,
  Panel,
  ScrollRegion,
  StatTile,
  ToneBadge,
} from '../../components/kit';
import { cn } from '@/lib/utils';
import { statRow, statTile } from '../reports/stat-row';

const quietLink = 'text-muted-foreground hover:text-foreground hover:no-underline';

function CancelAttemptButton({ attemptId }: { attemptId: string }) {
  const request = useRef<{ version: number; key: string } | null>(null);
  const cancel = useAction(async () => {
    if (!request.current) {
      const attempt = await api.get<Attempt>(`/attempts/${attemptId}`);
      request.current = { version: attempt.version, key: crypto.randomUUID() };
    }
    return api.send(
      `/attempts/${attemptId}/cancel`,
      'POST',
      {
        version: request.current.version,
      },
      request.current.key,
    );
  });
  return (
    <div>
      <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel attempt'}
      </Button>
      <ErrorNotice error={cancel.error} />
    </div>
  );
}

const actionRow = 'flex flex-wrap items-center gap-2 empty:hidden';

type PlanChange = (plan: DailyPlan, item: PlanItem, action: string) => void;
function PlanActions({
  item,
  featured,
  onChanged,
}: {
  item: PlanItem;
  featured: boolean;
  onChanged: PlanChange;
}) {
  const navigate = useNavigate();
  const [snoozing, setSnoozing] = useState(false);
  const [until, setUntil] = useState('');
  const action = useAction(async (choice: string) => {
    if (choice === 'start') {
      const attempt = await api.send<Attempt>('/attempts', 'POST', {
        problemId: item.problemId,
        planItemId: item.id,
        context: 'mixed',
        language: 'python',
      });
      navigate(`/attempts/${attempt.id}`);
      return;
    }
    const updated = await api.send<DailyPlan>(
      `/plan-items/${item.id}/${choice === 'activate' ? 'activate' : 'disposition'}`,
      'POST',
      choice === 'activate' ? {} : { action: choice, ...(choice === 'snooze' ? { until } : {}) },
    );
    onChanged(updated, item, choice);
    setSnoozing(false);
  });
  const available = !['completed', 'skipped'].includes(item.status);
  return (
    <>
      <div className={cn(actionRow, 'mt-3.5')}>
        {item.attemptId && available ? (
          <>
            <Button asChild variant="default">
              <Link to={`/attempts/${item.attemptId}`}>Resume attempt</Link>
            </Button>
            <CancelAttemptButton attemptId={item.attemptId} />
          </>
        ) : (
          available &&
          featured &&
          item.problemId && (
            <Button
              variant="default"
              disabled={action.isPending}
              onClick={() => action.mutate(item.status === 'optional' ? 'activate' : 'start')}
            >
              {item.status === 'optional' ? 'Make next' : 'Start attempt'}
            </Button>
          )
        )}
        {available && !item.attemptId && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={action.isPending}
                aria-label={`More actions for ${item.title}`}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-50 flex min-w-44 flex-col rounded-2xl bg-popover p-1 text-popover-foreground shadow-[0_0_0_1px_var(--card-ring),0_8px_24px_rgb(0_0_0/0.12)] *:cursor-pointer *:rounded-xl *:px-3 *:py-2 *:text-sm *:outline-none *:data-highlighted:bg-muted"
                align="start"
                sideOffset={5}
              >
                <DropdownMenu.Item onSelect={() => action.mutate('swap')}>
                  Replace question
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setSnoozing(true)}>Postpone…</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => action.mutate('skip')}>
                  Skip today
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {snoozing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl bg-card p-4 ring-1 ring-card-ring"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate('snooze');
          }}
        >
          <Field label="Postpone until">
            <DateField required value={until} onValueChange={(value) => setUntil(value)} />
          </Field>
          <Button variant="outline" disabled={action.isPending}>
            Save date
          </Button>
        </form>
      )}
      <ErrorNotice error={action.error} />
    </>
  );
}

function PlanRow({
  item,
  featured,
  onChanged,
}: {
  item: PlanItem;
  featured: boolean;
  onChanged: PlanChange;
}) {
  const done = item.status === 'completed';
  const State = done ? CircleCheck : featured ? CirclePlay : Circle;
  return (
    <li
      data-plan-id={item.id}
      className={cn(
        'relative flex items-start gap-3.5 rounded-2xl px-4 py-2.5',
        featured &&
          'bg-muted py-3 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary',
      )}
    >
      <span
        className={cn(
          'grid h-6 shrink-0 place-items-center',
          done ? 'text-up' : featured ? 'text-brand-text' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        <State className="size-[1.125rem]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h3
            className={cn(
              'min-w-0 text-[0.9375rem] leading-6 font-medium tracking-[-0.005em] wrap-anywhere',
              featured && 'font-heading text-[1.0625rem] font-semibold tracking-[-0.01em]',
              done && 'text-muted-foreground line-through decoration-border',
            )}
          >
            {item.title}
          </h3>
          <RatingChip rating={item.rating} className="ml-auto" />
          <span
            className={cn(
              'shrink-0 text-[0.8125rem] text-muted-foreground tabular-nums',
              featured && 'font-semibold text-foreground',
            )}
          >
            {featured
              ? item.attemptId
                ? 'In progress'
                : 'Up next'
              : done
                ? 'Done'
                : ['active', 'queued'].includes(item.status)
                  ? null
                  : enumLabel(item.status)}
          </span>
        </div>
        <p className="text-[0.8125rem] text-muted-foreground" title={item.reason}>
          {item.reason.split(' · ')[0]}
        </p>
        {featured && <PlanActions item={item} featured={featured} onChanged={onChanged} />}
        {done && item.attemptId && <DifficultyButtons attemptId={item.attemptId} />}
      </div>
    </li>
  );
}

function RecentPractice({ items }: { items: Attempt[] }) {
  return items.length ? (
    <List className="-mt-2">
      {items.slice(0, 4).map((attempt) => {
        const solved = attempt.outcome === 'solved';
        return (
          <ListRow
            key={attempt.id}
            icon={solved ? Check : RotateCcw}
            tone={solved ? 'emerald' : 'rose'}
            className="items-center py-2"
            title={<span className="line-clamp-1 wrap-anywhere">{attempt.problem.title}</span>}
            to={`/attempts/${attempt.id}`}
            trailing={
              <span className={cn('font-medium', solved ? 'text-up' : 'text-warn')}>
                {enumLabel(attempt.outcome ?? 'unknown')}
              </span>
            }
            meta={
              <span className="flex justify-between gap-3 tabular-nums">
                <span>{dateLabel(attempt.finishedAt)}</span>
                <span>{duration(attempt.activeSeconds)}</span>
              </span>
            }
          />
        );
      })}
    </List>
  ) : (
    <p className="text-[0.8125rem] text-muted-foreground">
      Your completed attempts will appear here.
    </p>
  );
}

function PlanList({
  plan,
  featuredId,
  onChanged,
}: {
  plan: DailyPlan;
  featuredId?: string;
  onChanged: PlanChange;
}) {
  const items = plan.items;
  return (
    <>
      <ol className="-mx-2 flex flex-col gap-0.5">
        {items
          .filter((item) => item.status !== 'skipped')
          .map((item) => (
            <PlanRow
              key={item.id}
              item={item}
              featured={item.id === featuredId}
              onChanged={onChanged}
            />
          ))}
      </ol>
      {items.some((item) => item.status === 'skipped') && (
        <details className="border-t text-[0.8125rem]">
          <summary className="pb-1 text-muted-foreground hover:text-foreground">
            Plan changes ({items.filter((item) => item.status === 'skipped').length})
          </summary>
          <ul className="flex flex-col gap-2.5 pt-2 pb-1">
            {items
              .filter((item) => item.status === 'skipped')
              .map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">{item.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.reason === 'swap'
                      ? 'Replaced'
                      : item.reason === 'snooze'
                        ? 'Postponed'
                        : 'Skipped today'}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </>
  );
}

// Consecutive study days ending today (or yesterday, so an unfinished day keeps the streak).
function currentStreak(activity: ActivityDay[]) {
  const days = [...activity].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const [index, day] of days.entries()) {
    if (day.completedAttempts > 0) streak += 1;
    else if (index > 0 || streak > 0) break;
  }
  return streak;
}

function ActivityCard({ activity }: { activity: ActivityDay[] }) {
  const streak = currentStreak(activity);
  const active = activity.filter((day) => day.completedAttempts > 0).length;
  return (
    <Panel
      title="Activity"
      className="gap-3"
      icon={Flame}
      actions={
        <Link className={quietLink} to="/weekly-report">
          Weekly report
        </Link>
      }
    >
      <ActivityFigures
        items={[
          [streak, 'day streak'],
          [active, 'active days in 28'],
        ]}
      />
      <ActivityStrip activity={activity} />
    </Panel>
  );
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const openTutor = useTutor();
  const [planNotice, setPlanNotice] = useState('');
  const query = useQuery({
    queryKey: ['dashboard'],
    staleTime: 0,
    queryFn: async () => {
      await api.send('/daily-plan/ensure', 'POST', {});
      const dashboard = await api.get<DashboardData>('/dashboard');
      // A running pre-workspace backend can serve newly built static assets.
      // Reject its older payload before the activity card tries to render it.
      if (!Array.isArray(dashboard.activity)) {
        throw new Error('The local server is out of date. Stop it and launch BloomCode again.');
      }
      return dashboard;
    },
    refetchInterval: 60000,
  });
  const bloom = useBloomPlan();
  const recap = useQuery({ queryKey: ['recap', 'desk'], queryFn: () => api.get<Recap>('/recap') });
  const reviews = useQuery({
    queryKey: ['reviews'],
    queryFn: () => api.get<ReviewTarget[]>('/reviews'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  const d = query.data;
  const featured = d.activeAttempt
    ? d.plan?.items.find((item) => item.attemptId === d.activeAttempt?.id)
    : (d.plan?.items.find((item) => item.problemId && item.status === 'active') ??
      d.plan?.items.find(
        (item) => item.problemId && !['completed', 'skipped'].includes(item.status),
      ));
  const completed = d.plan?.items.filter((item) => item.status === 'completed').length ?? 0;
  const total = d.plan?.items.filter((item) => item.status !== 'skipped').length ?? 0;
  const today = reviewWeek(d.settings.timezone)[0];
  const scheduled = (reviews.data ?? []).filter(
    (review) => review.action !== 'none' && review.effectiveDate,
  );
  const overdue = scheduled.filter((review) => review.effectiveDate! < today).length;
  const dueToday = scheduled.filter((review) => review.effectiveDate === today).length;
  const perDay = d.settings.questionsPerDay ?? d.settings.primaryCount + d.settings.optionalCount;
  const pending = <span className="text-muted-foreground">–</span>;
  // Each column scrolls on its own when the window is short; the last card takes the spare height.
  const column = 'flex flex-col gap-4 lg:[&>*:last-child]:grow';

  return (
    <>
      <PageHeader
        title={greeting()}
        description={
          total
            ? `${Math.max(0, total - completed)} of ${total} questions left today · ${dateLabel(d.plan?.date ?? null)}`
            : dateLabel(d.plan?.date ?? null)
        }
        actions={
          <>
            <Button variant="outline" onClick={() => openTutor()}>
              Talk to your tutor
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings">
                <ListChecks aria-hidden="true" />
                {perDay} per day
              </Link>
            </Button>
          </>
        }
      />
      <FillPage>
        <div className={statRow}>
          <StatTile
            className={statTile}
            label="Today's plan"
            icon={Target}
            tone="solid"
            value={completed}
            unit={`/ ${total}`}
            sub={total ? undefined : 'No plan today'}
          >
            {total > 0 && (
              <Meter
                label="Today's plan progress"
                valueText={`${completed} of ${total} questions done`}
                value={completed}
                max={total}
              />
            )}
          </StatTile>
          <StatTile
            className={statTile}
            label="Practised this week"
            icon={BookOpenCheck}
            tone="sky"
            value={recap.data?.distinctQuestions ?? pending}
            sub={recap.data ? `${recap.data.completedAttempts} completed attempts` : ' '}
          />
          <StatTile
            className={statTile}
            label="Independent solves"
            icon={Sparkles}
            tone="emerald"
            value={recap.data?.independentSolves ?? pending}
            sub={
              recap.data ? (
                <>
                  <span>
                    <span className="font-medium text-up">No help</span> used this week
                  </span>
                </>
              ) : (
                ' '
              )
            }
          />
          <StatTile
            className={statTile}
            label="Checks due"
            icon={CalendarClock}
            tone="amber"
            value={reviews.data ? overdue + dueToday : pending}
            sub={
              reviews.data ? (
                overdue ? (
                  <Link to="/reviews" className="font-medium text-warn">
                    {overdue} overdue
                  </Link>
                ) : (
                  `${dueToday} due today`
                )
              ) : (
                ' '
              )
            }
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ScrollRegion className={column}>
            <Panel
              title="Today's plan"
              icon={Target}
              meta={`${completed}/${total}`}
              className="gap-3"
            >
              {d.activeAttempt && !featured && (
                <div className="flex flex-col gap-2 border-b pb-4">
                  <ToneBadge tone="brand">
                    <Play aria-hidden="true" />
                    Continue studying
                  </ToneBadge>
                  <h3 className="font-heading text-[1.0625rem] font-semibold tracking-[-0.01em] wrap-anywhere">
                    {d.activeAttempt.problem.title}
                  </h3>
                  <div className={cn(actionRow, 'mt-1')}>
                    <Button asChild>
                      <Link to={`/attempts/${d.activeAttempt.id}`}>Resume attempt</Link>
                    </Button>
                    <CancelAttemptButton attemptId={d.activeAttempt.id} />
                  </div>
                </div>
              )}
              {planNotice && (
                <div role="status">
                  <Callout tone="brand" className="text-[0.8125rem]">
                    {planNotice}
                  </Callout>
                </div>
              )}
              {d.plan && (
                <BloomPlanNote
                  state={bloom.data}
                  planId={d.plan.id}
                  hasItems={!!d.plan.items.length}
                />
              )}
              {d.plan?.items.length ? (
                <PlanList
                  key={`${d.plan.id}-${d.plan.version}`}
                  plan={d.plan}
                  featuredId={featured?.id}
                  onChanged={(updated, previous, action) => {
                    const replacement = updated.items.find(
                      (item) => !d.plan?.items.some((old) => old.id === item.id),
                    );
                    setPlanNotice(
                      action === 'swap' && replacement
                        ? `Replaced “${previous.title}” with “${replacement.title}”. The new question is in your plan below.`
                        : action === 'snooze'
                          ? `“${previous.title}” postponed. Its review date has been updated.`
                          : action === 'skip'
                            ? `Skipped “${previous.title}” for today.`
                            : 'Plan updated.',
                    );
                  }}
                />
              ) : bloom.planning ? null : (
                <EmptyState
                  icon={ListChecks}
                  title="No questions at your level yet"
                  description="Questions come from the LeetCode problem bank, chosen for your level in each topic. Download it in Settings, or wait for scheduled reviews."
                  action={
                    <>
                      <Button asChild>
                        <Link to="/settings">Get the problem bank</Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link to="/library">Open library</Link>
                      </Button>
                    </>
                  }
                />
              )}
            </Panel>
            <ReviewCalendar timezone={d.settings.timezone} compact />
          </ScrollRegion>
          <ScrollRegion className={column}>
            <ActivityCard activity={d.activity} />
            <Panel
              title="Recent practice"
              className="gap-3"
              icon={History}
              actions={
                <Link className={quietLink} to="/topics">
                  Topic progress
                </Link>
              }
            >
              <RecentPractice items={d.recentAttempts} />
            </Panel>
          </ScrollRegion>
        </div>
      </FillPage>
    </>
  );
}
