import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpenCheck, CalendarCheck, ChevronLeft, ChevronRight, ChartNoAxesCombined, ListChecks, Sparkles, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ActivityDay, WeeklyRecap as Recap } from '../shared/contracts';
import { api } from './api';
import { dateLabel, ErrorNotice, Icon, Loading, PageTitle, SectionTitle } from './ui';
import { enumLabel, helpLabel } from './labels';

function shiftWeek(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Same card language as the Study desk stat row.
export function StatTile({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub: ReactNode; icon: LucideIcon; tone: 'solid' | 'sky' | 'emerald' | 'amber' | 'rose' }) {
  return <Card className="panel stat-card">
    <span className={`stat-icon ${tone === 'solid' ? 'solid' : `tone-${tone}`}`} aria-hidden="true"><Icon icon={icon} /></span>
    <p className="stat-label">{label}</p>
    <p className="stat-value">{value}</p>
    <p className="stat-sub">{sub}</p>
  </Card>;
}

function ActivityStrip({ activity }: { activity: ActivityDay[] }) {
  return <TooltipProvider>
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
  </TooltipProvider>;
}

function SupportingRecords({ recap }: { recap: Recap }) {
  if (recap.detailsHidden) return <p className="small muted">Finish your mixed practice to see supporting records and score changes.</p>;
  return <>
    <section className="recap-section">
      <h3>Completed attempts</h3>
      {recap.attempts.length ? <ul className="plain-list recap-records">
        {recap.attempts.map(attempt => <li key={attempt.id}>
          <Link to={`/attempts/${attempt.id}`}>{attempt.problem.title}</Link>
          <span className="small">{dateLabel(attempt.studyDate)} · {enumLabel(attempt.outcome)} · {helpLabel(attempt.help)}{attempt.scheduledReview ? ' · Scheduled review' : ''}</span>
        </li>)}
      </ul> : <p className="small muted">No completed attempts this week yet.</p>}
    </section>
    <section className="recap-section">
      <h3>Recorded score changes</h3>
      {recap.movements.length ? <ul className="plain-list recap-records">{recap.movements.map(movement => <li key={movement.id}>
        <Link to={movement.attemptId ? `/attempts/${movement.attemptId}` : `/topics/${movement.topicId}`}>{movement.topicName}: {movement.oldScore} → {movement.newScore}</Link>
        <span className="small">{dateLabel(movement.date)}</span>
      </li>)}</ul> : <p className="small muted">No recorded score changes this week.</p>}
    </section>
    <p className="small muted recap-footnote">Independent solves used no help. Scheduled reviews count attempts linked to a scheduled review in a daily plan; unlinked historical reviews are excluded. Weeks use the study date saved with each attempt.</p>
  </>;
}

export function WeeklyRecap({ activity, compact = false }: { activity: ActivityDay[]; compact?: boolean }) {
  const [week, setWeek] = useState('');
  const mountId = useId();
  const query = useQuery({ queryKey: ['recap', mountId, week], gcTime: 0, staleTime: 0, queryFn: () => api.get<Recap>(`/recap${week ? `?week=${week}` : ''}`) });
  const recap = query.data;
  const loading = query.isPending || query.isFetching;
  const ready = !loading && !query.isError && recap ? recap : undefined;

  if (compact) return <Card className="panel weekly-recap">
    <div className="section-heading"><SectionTitle icon={ChartNoAxesCombined}>{week ? 'Week in review' : 'This week'}</SectionTitle></div>
    {loading ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : recap && <>
      <p className="small muted">{dateLabel(recap.weekStart)} – {dateLabel(recap.weekEnd)} · {recap.timezone}</p>
      <div className="recap-metrics">
        <div><strong>{recap.distinctQuestions}</strong><span>questions practised</span></div>
        <div><strong>{recap.independentSolves}</strong><span>independent solves</span></div>
      </div>
      <p className="small">{recap.completedAttempts} completed attempts · {recap.scheduledReviews} scheduled reviews completed</p>
    </>}
    <div className="activity-section">
      <div className="row between"><h3>Last 28 days</h3><span className="small">Completed attempts</span></div>
      <ActivityStrip activity={activity} />
      <p className="small muted">Each square is one study day. Hover or focus for details.</p>
    </div>
    <Link className="small" to="/weekly-report">View weekly report →</Link>
  </Card>;

  const pending = <span className="muted">–</span>;
  const activeDays = activity.filter(day => day.completedAttempts > 0).length;
  const attempts28 = activity.reduce((sum, day) => sum + day.completedAttempts, 0);
  return <>
    <PageTitle title="Weekly report" description={recap ? `${week ? 'Week in review' : 'This week'} · ${dateLabel(recap.weekStart)} – ${dateLabel(recap.weekEnd)} · ${recap.timezone}` : week ? 'Week in review' : 'This week'}>
      <div className="report-nav">
        {week && <Button variant="ghost" size="sm" onClick={() => setWeek('')}>Current week</Button>}
        <Button variant="outline" size="icon" aria-label="Previous week" disabled={!recap} onClick={() => recap && setWeek(shiftWeek(recap.weekStart, -7))}><Icon icon={ChevronLeft} /></Button>
        <Button variant="outline" size="icon" aria-label="Next week" disabled={!recap} onClick={() => recap && setWeek(shiftWeek(recap.weekStart, 7))}><Icon icon={ChevronRight} /></Button>
      </div>
    </PageTitle>
    <div className="desk-stats">
      <StatTile label="Questions practised" icon={BookOpenCheck} tone="sky" value={ready?.distinctQuestions ?? pending} sub={ready ? 'Distinct questions' : ' '} />
      <StatTile label="Independent solves" icon={Sparkles} tone="emerald" value={ready?.independentSolves ?? pending} sub={ready ? <><span className="up">No help</span> used</> : ' '} />
      <StatTile label="Completed attempts" icon={ListChecks} tone="solid" value={ready?.completedAttempts ?? pending} sub={ready ? 'Finished this week' : ' '} />
      <StatTile label="Scheduled reviews" icon={CalendarCheck} tone="amber" value={ready?.scheduledReviews ?? pending} sub={ready ? 'Completed from your plan' : ' '} />
    </div>
    <div className="report-grid fill-page">
      <Card className="panel report-activity">
        <div className="section-heading">
          <h2 className="section-title">Last 28 days</h2>
          <span className="desk-count">Completed attempts</span>
        </div>
        <div className="desk-activity-summary">
          <div><strong>{activeDays}</strong><span>active days</span></div>
          <div><strong>{attempts28}</strong><span>completed attempts</span></div>
        </div>
        <ActivityStrip activity={activity} />
        <div className="activity-legend" aria-hidden="true"><span>Less</span><i className="activity-day" /><i className="activity-day intensity-1" /><i className="activity-day intensity-2" /><i className="activity-day intensity-3" /><span>More</span></div>
        <p className="small muted">Each square is one study day. Hover or focus for details.</p>
      </Card>
      <Card className="panel report-records">
        <div className="section-heading"><h2 className="section-title">Supporting records</h2></div>
        {loading ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : recap && <SupportingRecords recap={recap} />}
      </Card>
    </div>
  </>;
}
