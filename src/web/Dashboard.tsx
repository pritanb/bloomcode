import {
  ChartNoAxesCombined,
  CalendarCheck,
  Clock3,
  History,
  ListChecks,
  Play,
  Check,
  Circle,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type {
  Attempt,
  Dashboard as DashboardData,
  DailyPlan,
  PlanItem,
  Topic,
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
  MovementList,
  PageTitle,
  useAction,
} from './ui';
export function TopicTable({
  topics,
  limit,
}: {
  topics: Topic[];
  limit?: number;
}) {
  const [sort, setSort] = useState('score');
  const sorted = [...topics].sort((a, b) =>
    sort === 'score'
      ? (a.score ?? 6) - (b.score ?? 6)
      : (b.lastMovement?.recordedAt ?? '').localeCompare(
          a.lastMovement?.recordedAt ?? '',
        ),
  );
  return (
    <>
      <div className="section-heading">
        <SectionTitle icon={ChartNoAxesCombined}>Topic scores</SectionTitle>
        <Field label="Sort topics">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Lowest score first</option>
            <option value="recent">Recent movement</option>
          </select>
        </Field>
      </div>
      <p className="small muted">
        Your proficiency, on the existing 1–5 scale. Not question difficulty.
      </p>
      {sorted.length ? (
        <div className="topic-table">
          {sorted.slice(0, limit).map((t) => (
            <Link className="topic-row" key={t.id} to={`/topics/${t.id}`}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.provisional ? 'Provisional · ' : ''}Reviewed{' '}
                  {dateLabel(t.lastReviewed)}
                </small>
              </div>
              <div className="topic-score">
                <strong>{t.score ?? 'Unrated'}</strong>
                {t.score !== null && <span> / 5</span>}
                <div className="score-track" aria-hidden="true">
                  <i style={{ width: `${((t.score ?? 0) / 5) * 100}%` }} />
                </div>
                {t.lastMovement && (
                  <small>
                    {t.lastMovement.oldScore === t.lastMovement.newScore
                      ? 'No change'
                      : `${t.lastMovement.oldScore} → ${t.lastMovement.newScore}`}
                  </small>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty>
          No topic scores yet. Import your existing records or save an
          evidence-based tutor review.
        </Empty>
      )}
    </>
  );
}
function PlanRow({ item }: { item: PlanItem }) {
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
    <li className={`plan-row ${item.status}`}>
      <span className="plan-indicator" aria-hidden="true">
        <Icon
          icon={
            item.status === 'completed'
              ? Check
              : item.status === 'active'
                ? ChevronRight
                : Circle
          }
        />
      </span>
      <div className="plan-content">
        <div className="row between">
          <h3>{item.title}</h3>
          <span className="badge">{item.status}</span>
        </div>
        <p className="muted small">
          Suggested window: {item.suggestedMinutes} min
        </p>
        <div className="row">
          {item.attemptId && available ? (
            <Link className="button primary" to={`/attempts/${item.attemptId}`}>
              Resume
            </Link>
          ) : (
            available &&
            item.problemId && (
              <button
                className={item.status === 'active' ? 'primary' : ''}
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    item.status === 'optional' ? 'activate' : 'start',
                  )
                }
              >
                <Icon icon={Play} />
                {item.status === 'optional' ? 'Make next' : 'Start attempt'}
              </button>
            )
          )}
          {available && (
            <>
              <button
                disabled={action.isPending}
                onClick={() => action.mutate('swap')}
              >
                Swap
              </button>
              <button
                disabled={action.isPending}
                onClick={() => setSnoozing(!snoozing)}
              >
                Snooze
              </button>
              <button
                className="quiet"
                disabled={action.isPending}
                onClick={() => action.mutate('skip')}
              >
                Skip
              </button>
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
              <input
                type="date"
                required
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
            <button disabled={action.isPending}>Save snooze</button>
          </form>
        )}
        <ErrorNotice error={action.error} />
      </div>
    </li>
  );
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
        description="A manageable plan. Evidence that stays with you."
      >
        <Link className="budget" to="/settings">
          <Icon icon={Clock3} />
          <strong>{d.settings.budgetMinutes} min</strong>
          <span>Daily budget</span>
        </Link>
      </PageTitle>
      <div className="dashboard-grid">
        <section className="panel plan-panel">
          <div className="section-heading">
            <SectionTitle icon={CalendarCheck}>Today’s plan</SectionTitle>
            <span className="small muted">
              {dateLabel(d.plan?.date ?? null)}
            </span>
          </div>
          {d.activeAttempt && (
            <div className="resume-banner">
              <div>
                <strong>Pick up where you left off</strong>
                <p>{d.activeAttempt.problem.title}</p>
              </div>
              <Link
                className="button primary"
                to={`/attempts/${d.activeAttempt.id}`}
              >
                Resume attempt
              </Link>
            </div>
          )}
          {d.plan?.items.length ? (
            <ol className="plan-list">
              {d.plan.items.map((item) => (
                <PlanRow key={item.id} item={item} />
              ))}
            </ol>
          ) : (
            <Empty>
              <h3>Your next question starts here</h3>
              <p>
                Add questions to your library, or import your existing study
                records. Your plan will use your saved budget.
              </p>
              <Link className="button primary" to="/library">
                Open library
              </Link>
            </Empty>
          )}
          <p className="panel-footnote">
            Skipped days don’t create catch-up quotas. Optional work stays
            optional.
          </p>
        </section>
        <section className="panel">
          <TopicTable topics={d.topics} limit={6} />
          {d.topics.length > 6 && (
            <Link className="back-link" to="/topics">
              View all {d.topics.length} topics
            </Link>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <SectionTitle icon={ListChecks}>
              Recent score decisions
            </SectionTitle>
          </div>
          <MovementList items={d.movements.slice(0, 3)} />
          {d.movements.length > 3 && (
            <details>
              <summary>More score decisions</summary>
              <MovementList items={d.movements.slice(3)} />
            </details>
          )}
        </section>
        <section className="panel recent-practice">
          <div className="section-heading">
            <SectionTitle icon={History}>Recent practice</SectionTitle>
          </div>
          <AttemptList items={d.recentAttempts.slice(0, 5)} />
          {d.recentAttempts.length > 5 && (
            <details>
              <summary>More recent practice</summary>
              <AttemptList items={d.recentAttempts.slice(5)} />
            </details>
          )}
        </section>
      </div>
    </>
  );
}
