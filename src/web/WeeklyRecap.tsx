import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChartNoAxesCombined } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/disclosure';
import type { ActivityDay, WeeklyRecap as Recap } from '../shared/contracts';
import { api } from './api';
import { dateLabel, ErrorNotice, Icon, Loading, SectionTitle } from './ui';
import { enumLabel, helpLabel } from './labels';

function shiftWeek(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function WeeklyRecap({ activity }: { activity: ActivityDay[] }) {
  const [week, setWeek] = useState('');
  const mountId = useId();
  const query = useQuery({ queryKey: ['recap', mountId, week], gcTime: 0, staleTime: 0, queryFn: () => api.get<Recap>(`/recap${week ? `?week=${week}` : ''}`) });
  const recap = query.data;
  return <Card className="panel weekly-recap">
    <div className="section-heading">
      <SectionTitle icon={ChartNoAxesCombined}>{week ? 'Week in review' : 'This week'}</SectionTitle>
      <div className="row">
        <Button variant="ghost" size="icon" aria-label="Previous week" disabled={!recap} onClick={() => recap && setWeek(shiftWeek(recap.weekStart, -7))}><Icon icon={ChevronLeft} /></Button>
        <Button variant="ghost" size="icon" aria-label="Next week" disabled={!recap} onClick={() => recap && setWeek(shiftWeek(recap.weekStart, 7))}><Icon icon={ChevronRight} /></Button>
        {week && <Button variant="ghost" size="sm" onClick={() => setWeek('')}>Current week</Button>}
      </div>
    </div>
    {query.isPending || query.isFetching ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : recap && <>
      <p className="small muted">{dateLabel(recap.weekStart)} – {dateLabel(recap.weekEnd)} · {recap.timezone}</p>
      <div className="recap-metrics">
        <div><strong>{recap.distinctQuestions}</strong><span>questions practised</span></div>
        <div><strong>{recap.independentSolves}</strong><span>independent solves</span></div>
      </div>
      <p className="small">{recap.completedAttempts} completed attempts · {recap.scheduledReviews} scheduled reviews completed</p>
      {!recap.completedAttempts && <p className="muted">No completed attempts this week yet.</p>}
      {recap.detailsHidden ? <p className="small muted">Finish your mixed practice to see supporting records and score changes.</p> : <Disclosure title="View supporting records">
        <p className="small muted">Independent solves used no help. Scheduled reviews count attempts linked to a scheduled review in a daily plan; unlinked historical reviews are excluded. Weeks use the study date saved with each attempt.</p>
        <ul className="plain-list recap-records">
          {recap.attempts.map(attempt => <li key={attempt.id}>
            <Link to={`/attempts/${attempt.id}`}>{attempt.problem.title}</Link>
            <span className="small">{dateLabel(attempt.studyDate)} · {enumLabel(attempt.outcome)} · {helpLabel(attempt.help)}{attempt.scheduledReview ? ' · Scheduled review' : ''}</span>
          </li>)}
        </ul>
        <h3>Recorded score changes</h3>
        {recap.movements.length ? <ul className="plain-list recap-records">{recap.movements.map(movement => <li key={movement.id}>
          <Link to={movement.attemptId ? `/attempts/${movement.attemptId}` : `/topics/${movement.topicId}`}>{movement.topicName}: {movement.oldScore} → {movement.newScore}</Link>
          <span className="small">{dateLabel(movement.date)}</span>
        </li>)}</ul> : <p className="small muted">No recorded score changes this week.</p>}
      </Disclosure>}
    </>}
    <div className="activity-section">
      <div className="row between"><h3>Last 28 days</h3><span className="small">Completed attempts</span></div>
      <div className="activity-strip" role="list" aria-label="Completed attempts by study day">
        {activity.map(day => <span key={day.date} role="listitem" tabIndex={0} className={`activity-day intensity-${Math.min(3, day.completedAttempts)}`} title={`${dateLabel(day.date)}: ${day.completedAttempts} completed attempts`} aria-label={`${dateLabel(day.date)}: ${day.completedAttempts} completed attempts`} />)}
      </div>
      <p className="small muted">Each square is one study day. Hover or focus for details.</p>
    </div>
  </Card>;
}
