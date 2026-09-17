import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReviewTarget } from '../shared/contracts';
import { api } from './api';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/disclosure';
import { ReviewEditor } from './Library';
import { dateLabel, ErrorNotice, Loading, SectionTitle } from './ui';

export function reviewWeek(timezone: string, now = new Date()): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const today = ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function ScheduledReview({ review }: { review: ReviewTarget }) {
  return <div className="stack review-calendar-entry">
    <Link to={`/library/${review.problemId}`}>{review.problemTitle}</Link>
    <span className="small muted">{review.action === 'manual' ? 'Chosen date' : review.action === 'snooze' ? 'Snoozed' : 'Recommended'} · {dateLabel(review.effectiveDate)}</span>
    <Disclosure title={`Reschedule ${review.problemTitle}`}><ReviewEditor key={`${review.id}-${review.version}`} review={{ ...review, constraint: null }} /></Disclosure>
  </div>;
}

export function ReviewCalendar({ timezone }: { timezone: string }) {
  const query = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewTarget[]>('/reviews') });
  const today = reviewWeek(timezone)[0];
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + weekOffset * 7 + index);
    return date.toISOString().slice(0, 10);
  });
  const selectedDate = days[selectedIndex];
  const reviews = (query.data ?? []).filter(review => review.action !== 'none' && review.effectiveDate).sort((a, b) => a.effectiveDate!.localeCompare(b.effectiveDate!) || a.problemTitle.localeCompare(b.problemTitle));
  const overdue = reviews.filter(review => review.effectiveDate! < today);
  return <Card className="panel stack">
    <SectionTitle icon={CalendarDays}>Review calendar</SectionTitle>
    <p className="small muted">Scheduled reviews · {timezone}</p>
    <p className="small muted">Changing a review date keeps any question already assigned to your current plan.</p>
    {query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : <>
      {overdue.length > 0 && <Disclosure title={`Overdue · ${overdue.length}`}><div className="stack">{overdue.map(review => <ScheduledReview review={review} key={review.id} />)}</div></Disclosure>}
      <div className="row between">
        <Button type="button" variant="outline" size="sm" onClick={() => setWeekOffset(value => value - 1)}>Previous week</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setWeekOffset(0); setSelectedIndex(0); }}>Today</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setWeekOffset(value => value + 1)}>Next week</Button>
      </div>
      <div className="review-calendar-grid">{days.map((day, index) => {
        const count = reviews.filter(review => review.effectiveDate === day).length;
        return <Button type="button" variant={index === selectedIndex ? 'default' : 'outline'} className="review-calendar-day" key={day} aria-pressed={index === selectedIndex} aria-controls="selected-review-day" aria-label={`${dateLabel(day)}, ${count} ${count === 1 ? 'review' : 'reviews'}`} onClick={() => setSelectedIndex(index)}>
          <span>{day === today ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</span>
          <span>{Number(day.slice(-2))}</span>
          <span className="small">{count}</span>
        </Button>;
      })}</div>
      <section id="selected-review-day" className="stack" aria-live="polite">
        <h3>{dateLabel(selectedDate)}</h3>
        {reviews.some(review => review.effectiveDate === selectedDate) ? reviews.filter(review => review.effectiveDate === selectedDate).map(review => <ScheduledReview review={review} key={review.id} />) : <p className="small muted">No reviews scheduled for this day.</p>}
      </section>
    </>}
  </Card>;
}
