import { DropdownMenu } from 'radix-ui';
import { enumLabel } from './labels';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CirclePlay,
  ListChecks,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
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
} from '../shared/contracts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from './api';
import { ReviewCalendar, reviewWeek } from './ReviewCalendar';
import {
  Icon,
  dateLabel,
  duration,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  PageTitle,
  useAction,
} from './ui';
function CancelAttemptButton({ attemptId }: { attemptId: string }) {
  const request = useRef<{ version: number; key: string } | null>(null);
  const cancel = useAction(async () => {
    if (!request.current) {
      const attempt = await api.get<Attempt>(`/attempts/${attemptId}`);
      request.current = { version: attempt.version, key: crypto.randomUUID() };
    }
    return api.send(`/attempts/${attemptId}/cancel`, 'POST', {
      version: request.current.version,
    }, request.current.key);
  });
  return <div>
    <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
      {cancel.isPending ? 'Cancelling…' : 'Cancel attempt'}
    </Button>
    <ErrorNotice error={cancel.error} />
  </div>;
}

type PlanChange = (plan: DailyPlan, item: PlanItem, action: string) => void;
function PlanActions({ item, featured, onChanged }: { item: PlanItem; featured: boolean; onChanged: PlanChange }) {
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
      choice === 'activate'
        ? {}
        : { action: choice, ...(choice === 'snooze' ? { until } : {}) },
    );
    onChanged(updated, item, choice);
    setSnoozing(false);
  });
  const available = !['completed', 'skipped'].includes(item.status);
  return <>
        <div className="plan-actions">
          {item.attemptId && available ? (
            <>
              <Button asChild variant="default"><Link to={`/attempts/${item.attemptId}`}>
                Resume attempt
              </Link></Button>
              <CancelAttemptButton attemptId={item.attemptId} />
            </>
          ) : (
            available && featured &&
            item.problemId && (
              <Button
                variant="default"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    item.status === 'optional' ? 'activate' : 'start',
                  )
                }
              >
                {item.status === 'optional' ? 'Make next' : 'Start attempt'}
              </Button>
            )
          )}
          {available && !item.attemptId && <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" className="plan-more" disabled={action.isPending} aria-label={`More actions for ${item.title}`}><Icon icon={ChevronDown} /></Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="plan-action-menu" align="start" sideOffset={5}>
                <DropdownMenu.Item onSelect={() => action.mutate('swap')}>Replace question</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setSnoozing(true)}>Postpone…</DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => action.mutate('skip')}>Skip today</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>}
        </div>
        {snoozing && (
          <form
            className="row inset"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate('snooze');
            }}
          >
            <Field label="Postpone until">
              <DateField
                required
                value={until}
                onValueChange={(value) => setUntil(value)}
              />
            </Field>
            <Button variant="outline" disabled={action.isPending}>Save date</Button>
          </form>
        )}
        <ErrorNotice error={action.error} />
  </>;
}

function PlanRow({ item, featured, onChanged }: { item: PlanItem; featured: boolean; onChanged: PlanChange }) {
  const done = item.status === 'completed';
  return (
    <li data-plan-id={item.id} className={`plan-row ${item.status}${featured ? ' plan-featured' : ''}`}>
      <span className="plan-state" aria-hidden="true">
        <Icon icon={done ? CircleCheck : featured ? CirclePlay : Circle} />
      </span>
      <div className="plan-content">
        <div className="row between">
          <h3>{item.title}</h3>
          <span className="plan-meta">
            {featured ? item.attemptId ? 'In progress' : 'Up next' : done ? 'Done' : ['active', 'queued'].includes(item.status) ? `~${item.suggestedMinutes} min` : enumLabel(item.status)}
          </span>
        </div>
        <p className="plan-reason" title={item.reason}>{item.reason.split(' · ')[0]}</p>
        {featured && <PlanActions item={item} featured={featured} onChanged={onChanged} />}
      </div>
    </li>
  );
}
function RecentPractice({ items }: { items: Attempt[] }) {
  return items.length ? <ul className="plain-list desk-recent">{items.slice(0, 4).map(attempt => {
    const solved = attempt.outcome === 'solved';
    return <li key={attempt.id}>
      <span className={`desk-recent-icon${solved ? ' solved' : ''}`} aria-hidden="true"><Icon icon={solved ? Check : RotateCcw} /></span>
      <div><Link to={`/attempts/${attempt.id}`}>{attempt.problem.title}</Link><span>{dateLabel(attempt.finishedAt)}</span></div>
      <div className="desk-recent-result"><span className={solved ? 'up' : 'warn'}>{enumLabel(attempt.outcome ?? 'unknown')}</span><span>{duration(attempt.activeSeconds)}</span></div>
    </li>;
  })}</ul> : <p className="muted">Your completed attempts will appear here.</p>;
}

function PlanList({ plan, featuredId, onChanged }: { plan: DailyPlan; featuredId?: string; onChanged: PlanChange }) {
  const items = plan.items;
  return <>
    <ol className="plan-list desk-plan">
      {items.filter(item => item.status !== 'skipped').map(item => <PlanRow key={item.id} item={item} featured={item.id === featuredId} onChanged={onChanged} />)}
    </ol>
    {items.some(item => item.status === 'skipped') && <details className="plan-history">
      <summary>Plan changes ({items.filter(item => item.status === 'skipped').length})</summary>
      <ul className="plain-list">{items.filter(item => item.status === 'skipped').map(item => <li key={item.id} className="row between">
        <span>{item.title}</span><span className="small muted">{item.reason === 'swap' ? 'Replaced' : item.reason === 'snooze' ? 'Postponed' : 'Skipped today'}</span>
      </li>)}</ul>
    </details>}
  </>;
}

function StatCard({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub: ReactNode; icon: LucideIcon; tone: 'solid' | 'sky' | 'emerald' | 'amber' }) {
  return <Card className="panel stat-card">
    <span className={`stat-icon ${tone === 'solid' ? 'solid' : `tone-${tone}`}`} aria-hidden="true"><Icon icon={icon} /></span>
    <p className="stat-label">{label}</p>
    <p className="stat-value">{value}</p>
    <p className="stat-sub">{sub}</p>
  </Card>;
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
  const active = activity.filter(day => day.completedAttempts > 0).length;
  return <Card className="panel desk-activity">
    <div className="section-heading">
      <h2 className="section-title">Activity</h2>
      <Link className="desk-link" to="/weekly-report">Weekly report</Link>
    </div>
    <div className="desk-activity-summary">
      <div><strong>{streak}</strong><span>day streak</span></div>
      <div><strong>{active}</strong><span>active days in 28</span></div>
    </div>
    <TooltipProvider>
      <div className="activity-strip" role="list" aria-label="Completed attempts by study day">
        {activity.map(day => {
          const label = `${dateLabel(day.date)}: ${day.completedAttempts} completed ${day.completedAttempts === 1 ? 'attempt' : 'attempts'}`;
          return <Tooltip key={day.date}>
            <TooltipTrigger asChild>
              <span role="listitem" tabIndex={0} className={`activity-day intensity-${Math.min(3, day.completedAttempts)}`} aria-label={label} />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>;
        })}
      </div>
    </TooltipProvider>
    <div className="activity-legend" aria-hidden="true"><span>Less</span><i className="activity-day" /><i className="activity-day intensity-1" /><i className="activity-day intensity-2" /><i className="activity-day intensity-3" /><span>More</span></div>
  </Card>;
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
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
        throw new Error('The local server is out of date. Stop it and launch LeetCode Tutor again.');
      }
      return dashboard;
    },
    refetchInterval: 60000,
  });
  const recap = useQuery({ queryKey: ['recap', 'desk'], queryFn: () => api.get<Recap>('/recap') });
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewTarget[]>('/reviews') });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const d = query.data;
  const featured = d.activeAttempt
    ? d.plan?.items.find(item => item.attemptId === d.activeAttempt?.id)
    : d.plan?.items.find(item => item.problemId && item.status === 'active')
      ?? d.plan?.items.find(item => item.problemId && !['completed', 'skipped'].includes(item.status));
  const completed = d.plan?.items.filter(item => item.status === 'completed').length ?? 0;
  const total = d.plan?.items.filter(item => item.status !== 'skipped').length ?? 0;
  const today = reviewWeek(d.settings.timezone)[0];
  const scheduled = (reviews.data ?? []).filter(review => review.action !== 'none' && review.effectiveDate);
  const overdue = scheduled.filter(review => review.effectiveDate! < today).length;
  const dueToday = scheduled.filter(review => review.effectiveDate === today).length;
  const perDay = d.settings.questionsPerDay ?? d.settings.primaryCount + d.settings.optionalCount;
  const pending = <span className="muted">–</span>;

  return (
    <>
      <PageTitle
        title={greeting()}
        description={total ? `${Math.max(0, total - completed)} of ${total} questions left today · ${dateLabel(d.plan?.date ?? null)}` : dateLabel(d.plan?.date ?? null)}
      >
        <Button asChild variant="outline"><Link to="/settings"><Icon icon={ListChecks} />{perDay} per day</Link></Button>
      </PageTitle>
      <div className="desk-stats">
        <StatCard label="Today's plan" icon={Target} tone="solid" value={<>{completed}<span> / {total}</span></>} sub={total ? <span className="stat-progress"><i style={{ width: `${(completed / total) * 100}%` }} /></span> : 'No plan today'} />
        <StatCard label="Practised this week" icon={BookOpenCheck} tone="sky" value={recap.data?.distinctQuestions ?? pending} sub={recap.data ? `${recap.data.completedAttempts} completed attempts` : ' '} />
        <StatCard label="Independent solves" icon={Sparkles} tone="emerald" value={recap.data?.independentSolves ?? pending} sub={recap.data ? <><span className="up">No help</span> used this week</> : ' '} />
        <StatCard label="Reviews due" icon={CalendarClock} tone="amber" value={reviews.data ? overdue + dueToday : pending} sub={reviews.data ? overdue ? <Link to="/reviews" className="warn">{overdue} overdue</Link> : `${dueToday} due today` : ' '} />
      </div>
      <div className="desk-grid fill-page">
        <div className="desk-column">
          <Card className="panel plan-panel">
            <div className="section-heading">
              <h2 className="section-title">Today's plan</h2>
              <span className="desk-count">{completed}/{total}</span>
            </div>
            {d.activeAttempt && !featured && <div className="plan-active-attempt">
              <span className="next-label"><Icon icon={Play} />Continue studying</span>
              <h3>{d.activeAttempt.problem.title}</h3>
              <div className="plan-actions">
                <Button asChild><Link to={`/attempts/${d.activeAttempt.id}`}>Resume attempt</Link></Button>
                <CancelAttemptButton attemptId={d.activeAttempt.id} />
              </div>
            </div>}
            {planNotice && <p className="small plan-change-notice" role="status">{planNotice}</p>}
            {d.plan?.items.length ? (
              <PlanList key={`${d.plan.id}-${d.plan.version}`} plan={d.plan} featuredId={featured?.id} onChanged={(updated, previous, action) => {
                const replacement = updated.items.find(item => !d.plan?.items.some(old => old.id === item.id));
                setPlanNotice(action === 'swap' && replacement ? `Replaced “${previous.title}” with “${replacement.title}”. The new question is in your plan below.` : action === 'snooze' ? `“${previous.title}” postponed. Its review date has been updated.` : action === 'skip' ? `Skipped “${previous.title}” for today.` : 'Plan updated.');
              }} />
            ) : <Empty>
              <h3>No eligible questions in this plan</h3>
              <p>Your selected list, completion policy or review dates may leave no questions available. Topic progression waits for completion; it does not skip a snoozed topic. No questions are pulled from outside your selected list.</p>
              <div className="row"><Button asChild><Link to="/settings">Review recommendation settings</Link></Button><Button asChild variant="outline"><Link to="/library">Open library</Link></Button></div>
            </Empty>}
          </Card>
          <ReviewCalendar timezone={d.settings.timezone} compact />
        </div>
        <div className="desk-column">
          <ActivityCard activity={d.activity} />
          <Card className="panel recent-practice">
            <div className="section-heading">
              <h2 className="section-title">Recent practice</h2>
              <Link className="desk-link" to="/topics">Topic progress</Link>
            </div>
            <RecentPractice items={d.recentAttempts} />
          </Card>
        </div>
      </div>
    </>
  );
}
