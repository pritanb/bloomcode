import { DropdownMenu } from 'radix-ui';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';
import { enumLabel } from './labels';
import { DateField } from '@/components/date-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CalendarCheck,
  ChevronDown,
  GripVertical,
  History,
  ListChecks,
  Play,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type {
  Attempt,
  Dashboard as DashboardData,
  DailyPlan,
  PlanItem,
} from '../shared/contracts';
import { api } from './api';
import { ReviewCalendar } from './ReviewCalendar';
import { WeeklyRecap } from './WeeklyRecap';
import {
  Icon,
  SectionTitle,
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
function PlanActions({ item, onChanged }: { item: PlanItem; onChanged: PlanChange }) {
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
            available &&
            item.problemId && (
              <Button
                variant={item.status === 'active' ? 'default' : 'outline'}
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

function PlanRow({ item, index, busy, featured, onChanged }: { item: PlanItem; index: number; busy: boolean; featured: boolean; onChanged: PlanChange }) {
  const movable = !['completed', 'skipped'].includes(item.status) && !item.attemptId;
  const { ref, handleRef, isDragSource } = useSortable({ id: item.id, index, disabled: busy || !movable });
  return (
    <li ref={ref} data-plan-id={item.id} className={`plan-row ${item.status}${featured ? ' plan-featured' : ''}${isDragSource ? ' is-dragging' : ''}`}>
      {movable ? <button ref={handleRef} type="button" className="plan-drag-handle" aria-label={`Reorder ${item.title}`} aria-disabled={busy}
        title="Drag to reorder. With keyboard, press Space, use arrow keys, then Space to drop.">
        <Icon icon={GripVertical} />
      </button> : <span className="plan-handle-spacer" aria-hidden="true" />}
      <div className="plan-content">
        <div className="row between">
          <h3>{item.title}</h3>
          <Badge variant="secondary" className="badge">{featured ? item.attemptId ? 'In progress' : 'Up next' : enumLabel(item.status)}</Badge>
        </div>
        <p className="small muted" title={item.reason}>{item.reason.split(' · ')[0]}</p>
        <PlanActions item={item} onChanged={onChanged} />

      </div>
    </li>
  );
}
function RecentPractice({ items }: { items: Attempt[] }) {
  return items.length ? <ul className="plain-list compact-practice">{items.slice(0, 3).map(attempt => <li key={attempt.id}>
    <div><Link to={`/attempts/${attempt.id}`}>{attempt.problem.title}</Link><span className="small muted">{dateLabel(attempt.finishedAt)}</span></div>
    <span className="small muted">{enumLabel(attempt.outcome ?? 'unknown')} · {duration(attempt.activeSeconds)}</span>
  </li>)}</ul> : <p className="small muted">Your completed attempts will appear here.</p>;
}

function PlanList({ plan, featuredId, onChanged }: { plan: DailyPlan; featuredId?: string; onChanged: PlanChange }) {
  const [items, setItems] = useState(plan.items);
  const reorder = useAction((itemIds: string[]) => api.send<DailyPlan>(`/daily-plans/${plan.id}/reorder`, 'POST', { version: plan.version, itemIds }));
  return <>
    <ErrorNotice error={reorder.error} />
    <span className="sr-only" role="status">{reorder.isPending ? 'Saving order' : reorder.isSuccess ? 'Plan order saved' : ''}</span>
    <DragDropProvider onDragEnd={event => {
      if (event.canceled || reorder.isPending) return;
      const { source } = event.operation;
      if (!isSortable(source) || source.initialIndex === source.index) return;
      const next = items.filter(item => item.status !== 'skipped');
      const [moved] = next.splice(source.initialIndex, 1);
      if (!moved) return;
      next.splice(source.index, 0, moved);
      const ordered = [...next, ...items.filter(item => item.status === 'skipped')];
      setItems(ordered);
      reorder.mutate(ordered.map(item => item.id), { onError: () => setItems(plan.items) });
    }}>
      <ol className="plan-list">
        {items.filter(item => item.status !== 'skipped').map((item, index) => <PlanRow key={item.id} item={item} index={index} busy={reorder.isPending} featured={item.id === featuredId} onChanged={onChanged} />)}
      </ol>
    </DragDropProvider>
    {items.some(item => item.status === 'skipped') && <details className="plan-history">
      <summary>Plan changes ({items.filter(item => item.status === 'skipped').length})</summary>
      <ul className="plain-list">{items.filter(item => item.status === 'skipped').map(item => <li key={item.id} className="row between">
        <span>{item.title}</span><span className="small muted">{item.reason === 'swap' ? 'Replaced' : item.reason === 'snooze' ? 'Postponed' : 'Skipped today'}</span>
      </li>)}</ul>
    </details>}
  </>;
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
      // Reject its older payload before WeeklyRecap tries to render activity.
      if (!Array.isArray(dashboard.activity)) {
        throw new Error('The local server is out of date. Stop it and launch LeetCode Tutor again.');
      }
      return dashboard;
    },
    refetchInterval: 60000,
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const d = query.data;
  const featured = d.plan?.items.find(item => item.attemptId === d.activeAttempt?.id && d.activeAttempt)
    ?? (!d.activeAttempt ? d.plan?.items.find(item => item.problemId && !['completed', 'skipped'].includes(item.status)) : undefined);
  const completed = d.plan?.items.filter(item => item.status === 'completed').length ?? 0;
  const total = d.plan?.items.filter(item => item.status !== 'skipped').length ?? 0;

  return (
    <>
      <PageTitle
        title="Your study desk"
        description="A little practice, a little progress."
      >
        <Link className="budget" to="/settings">
          <Icon icon={ListChecks} />
          <strong>{d.settings.questionsPerDay ?? d.settings.primaryCount + d.settings.optionalCount}</strong>
          <span>Questions per day</span>
        </Link>
      </PageTitle>
      <div className="study-layout">
        <div className="study-primary">
          <Card className="panel plan-panel">
            <div className="section-heading">
              <SectionTitle icon={CalendarCheck}>Your plan</SectionTitle>
              <span className="small muted">{dateLabel(d.plan?.date ?? null)}</span>
            </div>
            {total > 0 && <div className="plan-progress">
              <span>{completed} of {total} completed</span>
              <progress value={completed} max={total} aria-label="Plan completion" />
            </div>}
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
        <div className="study-secondary">
          <WeeklyRecap activity={d.activity} compact />
          <Card className="panel recent-practice">
            <div className="section-heading">
              <SectionTitle icon={History}>Recent practice</SectionTitle>
              <Link className="small" to="/topics">Topic progress</Link>
            </div>
            <RecentPractice items={d.recentAttempts} />
          </Card>
        </div>
      </div>

    </>
  );
}
