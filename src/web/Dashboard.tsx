import { DragDropProvider } from '@dnd-kit/react';
import { useSortable, isSortable } from '@dnd-kit/react/sortable';
import { enumLabel } from './labels';
import { DateField } from '@/components/date-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CalendarCheck,
  GripVertical,
  History,
  ListChecks,
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
import {
  Icon,
  SectionTitle,
  AttemptList,
  dateLabel,
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

function PlanRow({ item, index, busy }: { item: PlanItem; index: number; busy: boolean }) {
  const movable = !['completed', 'skipped'].includes(item.status) && !item.attemptId;
  const { ref, handleRef, isDragSource } = useSortable({ id: item.id, index, disabled: busy || !movable });
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
    await api.send<DailyPlan>(
      `/plan-items/${item.id}/${choice === 'activate' ? 'activate' : 'disposition'}`,
      'POST',
      choice === 'activate'
        ? {}
        : { action: choice, ...(choice === 'snooze' ? { until } : {}) },
    );
    setSnoozing(false);
  });
  const available = !['completed', 'skipped'].includes(item.status);
  return (
    <li ref={ref} data-plan-id={item.id} className={`plan-row ${item.status}${isDragSource ? ' is-dragging' : ''}`}>
      {movable ? <button ref={handleRef} type="button" className="plan-drag-handle" aria-label={`Reorder ${item.title}`} aria-disabled={busy}
        title="Drag to reorder. With keyboard, press Space, use arrow keys, then Space to drop.">
        <Icon icon={GripVertical} />
      </button> : <span className="plan-handle-spacer" aria-hidden="true" />}
      <div className="plan-content">
        <div className="row between">
          <h3>{item.title}</h3>
          <Badge variant="secondary" className="badge">{enumLabel(item.status)}</Badge>
        </div>
        <div className="plan-actions">
          {item.attemptId && available ? (
            <>
              <Button asChild variant="default"><Link to={`/attempts/${item.attemptId}`}>
                Resume
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
          {available && !item.attemptId && (
            <>
              <Button variant="outline"
                disabled={action.isPending}
                onClick={() => setSnoozing(!snoozing)}
              >
                Snooze
              </Button>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('skip')}
              >
                Skip
              </Button>
            </>
          )}
        </div>
        {snoozing && (
          <form
            className="row inset"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate('snooze');
            }}
          >
            <Field label="Snooze until">
              <DateField
                required
                value={until}
                onValueChange={(value) => setUntil(value)}
              />
            </Field>
            <Button variant="outline" disabled={action.isPending}>Save snooze</Button>
          </form>
        )}
        <ErrorNotice error={action.error} />
      </div>
    </li>
  );
}
function RecentPractice({ items }: { items: Attempt[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 3;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * pageSize;
  return (
    <>
      <AttemptList items={items.slice(start, start + pageSize)} showReview={false} />
      {pages > 1 && (
        <nav className="row between" aria-label="Recent practice pages">
          <span className="small muted" role="status">
            {start + 1}–{Math.min(start + pageSize, items.length)} of {items.length} attempts · Page {currentPage + 1} of {pages}
          </span>
          <div className="row">
            <Button variant="outline" disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <Button variant="outline" disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        </nav>
      )}
    </>
  );
}

function PlanList({ plan }: { plan: DailyPlan }) {
  const [items, setItems] = useState(plan.items);
  const reorder = useAction((itemIds: string[]) => api.send<DailyPlan>(`/daily-plans/${plan.id}/reorder`, 'POST', { version: plan.version, itemIds }));
  return <>
    <ErrorNotice error={reorder.error} />
    <span className="sr-only" role="status">{reorder.isPending ? 'Saving order' : reorder.isSuccess ? 'Plan order saved' : ''}</span>
    <DragDropProvider onDragEnd={event => {
      if (event.canceled || reorder.isPending) return;
      const { source } = event.operation;
      if (!isSortable(source) || source.initialIndex === source.index) return;
      const next = [...items];
      const [moved] = next.splice(source.initialIndex, 1);
      if (!moved) return;
      next.splice(source.index, 0, moved);
      setItems(next);
      reorder.mutate(next.map(item => item.id), { onError: () => setItems(plan.items) });
    }}>
      <ol className="plan-list">
        {items.map((item, index) => <PlanRow key={item.id} item={item} index={index} busy={reorder.isPending} />)}
      </ol>
    </DragDropProvider>
  </>;
}

export function Dashboard() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      await api.send('/daily-plan/ensure', 'POST', {});
      return api.get<DashboardData>('/dashboard');
    },
    refetchInterval: 60000,
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const d = query.data;
  return (
    <>
      <PageTitle
        title="Your study desk"
        description="Your questions for today, ready when you are."
      >
        <Link className="budget" to="/settings">
          <Icon icon={ListChecks} />
          <strong>{d.settings.questionsPerDay ?? d.settings.primaryCount + d.settings.optionalCount}</strong>
          <span>Questions per day</span>
        </Link>
      </PageTitle>
      <div className="dashboard-grid">
        <Card className="panel plan-panel">
          <div className="section-heading">
            <SectionTitle icon={CalendarCheck}>Today’s plan</SectionTitle>
            <span className="small muted">
              {dateLabel(d.plan?.date ?? null)}
            </span>
          </div>
          {d.activeAttempt && !d.plan?.items.some(item => item.attemptId === d.activeAttempt?.id) && (
            <div className="resume-banner">
              <div>
                <strong>Pick up where you left off</strong>
                <p>{d.activeAttempt.problem.title}</p>
              </div>
              <div className="row">
                <Button asChild variant="default"><Link to={`/attempts/${d.activeAttempt.id}`}>
                  Resume attempt
                </Link></Button>
                <CancelAttemptButton attemptId={d.activeAttempt.id} />
              </div>
            </div>
          )}
          {d.plan?.items.length ? (
            <PlanList key={`${d.plan.id}-${d.plan.version}`} plan={d.plan} />
          ) : (
            <Empty>
              <h3>Your next question starts here</h3>
              <p>
                Add questions to your library, or import your existing study
                records. Your plan will use your daily question target.
              </p>
              <Button asChild variant="default"><Link  to="/library">
                Open library
              </Link></Button>
            </Empty>
          )}
        </Card>
        <Card className="panel recent-practice">
          <div className="section-heading">
            <SectionTitle icon={History}>Recent practice</SectionTitle>
            <Link className="small" to="/topics">View topic progress <span aria-hidden="true">→</span></Link>
          </div>
          <RecentPractice items={d.recentAttempts} />
        </Card>
      </div>
    </>
  );
}
