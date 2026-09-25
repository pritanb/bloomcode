import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReviewTarget } from '../../../shared/contracts';
import { api } from '../../app/api';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/disclosure';
import { ReviewEditor } from '../library/Library';
import { dateLabel, ErrorNotice, Icon, Loading, SectionTitle } from '../../components/ui';
import { StatTile } from './WeeklyRecap';

export function reviewWeek(timezone: string, now = new Date()): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const today = ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join('-');
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function ScheduledReview({ review }: { review: ReviewTarget }) {
  return (
    <div className="review-calendar-entry">
      <Link to={`/library/${review.problemId}`}>{review.problemTitle}</Link>
      <span className="review-entry-meta">
        {review.action === 'manual'
          ? 'Chosen date'
          : review.action === 'snooze'
            ? 'Snoozed'
            : 'Recommended'}{' '}
        · {dateLabel(review.effectiveDate)}
      </span>
      <Disclosure title={`Reschedule ${review.problemTitle}`}>
        <p className="small muted">
          Changing this date keeps any question already assigned to your current plan.
        </p>
        <ReviewEditor
          key={`${review.id}-${review.version}`}
          review={{ ...review, constraint: null }}
        />
      </Disclosure>
    </div>
  );
}

export function ReviewCalendar({
  timezone,
  compact = false,
}: {
  timezone: string;
  compact?: boolean;
}) {
  const query = useQuery({
    queryKey: ['reviews'],
    queryFn: () => api.get<ReviewTarget[]>('/reviews'),
  });
  const today = reviewWeek(timezone)[0];
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + weekOffset * 7 + index);
    return date.toISOString().slice(0, 10);
  });
  const selectedDate = days[selectedIndex];
  const reviews = (query.data ?? [])
    .filter((review) => review.action !== 'none' && review.effectiveDate)
    .sort(
      (a, b) =>
        a.effectiveDate!.localeCompare(b.effectiveDate!) ||
        a.problemTitle.localeCompare(b.problemTitle),
    );
  const overdue = reviews.filter((review) => review.effectiveDate! < today);
  const nav = (
    <div className="calendar-nav">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous week"
        onClick={() => setWeekOffset((value) => value - 1)}
      >
        <Icon icon={ChevronLeft} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setWeekOffset(0);
          setSelectedIndex(0);
        }}
      >
        Today
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next week"
        onClick={() => setWeekOffset((value) => value + 1)}
      >
        <Icon icon={ChevronRight} />
      </Button>
    </div>
  );
  const grid = (
    <div className="review-calendar-grid">
      {days.map((day, index) => {
        const count = reviews.filter((review) => review.effectiveDate === day).length;
        return (
          <Button
            type="button"
            variant={index === selectedIndex ? 'default' : 'outline'}
            className="review-calendar-day"
            key={day}
            aria-pressed={index === selectedIndex}
            aria-controls="selected-review-day"
            aria-label={`${dateLabel(day)}, ${count} ${count === 1 ? 'review' : 'reviews'}`}
            onClick={() => setSelectedIndex(index)}
          >
            <span>
              {day === today
                ? 'Today'
                : new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(
                    new Date(`${day}T12:00:00Z`),
                  )}
            </span>
            <span>{Number(day.slice(-2))}</span>
            <span className="small">{count}</span>
          </Button>
        );
      })}
    </div>
  );
  const selected = reviews.filter((review) => review.effectiveDate === selectedDate);
  if (compact)
    return (
      <Card className="panel stack review-calendar">
        <div className="section-heading">
          <SectionTitle icon={CalendarDays}>Review calendar</SectionTitle>
          {nav}
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {grid}
            <div id="selected-review-day" className="row between small" aria-live="polite">
              <span>
                {dateLabel(selectedDate)} · {selected.length} reviews
              </span>
              {overdue.length > 0 ? (
                <Link to="/reviews">{overdue.length} overdue →</Link>
              ) : (
                <Link to="/reviews">All reviews →</Link>
              )}
            </div>
          </>
        )}
      </Card>
    );
  if (query.isPending || query.isError)
    return (
      <Card className="panel stack review-calendar">
        <div className="section-heading">
          <SectionTitle icon={CalendarDays}>Review calendar</SectionTitle>
        </div>
        {query.isPending ? (
          <Loading />
        ) : (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        )}
      </Card>
    );
  const thisWeek = reviewWeek(timezone);
  const dueToday = reviews.filter((review) => review.effectiveDate === today).length;
  const nextSeven = reviews.filter(
    (review) => review.effectiveDate! >= today && review.effectiveDate! <= thisWeek[6],
  ).length;
  return (
    <>
      <div className="desk-stats">
        <StatTile
          label="Overdue"
          icon={CalendarX2}
          tone="rose"
          value={overdue.length}
          sub={
            overdue.length ? <span className="warn">Reschedule or practise</span> : 'All caught up'
          }
        />
        <StatTile
          label="Due today"
          icon={CalendarClock}
          tone="amber"
          value={dueToday}
          sub={dateLabel(today)}
        />
        <StatTile
          label="Next 7 days"
          icon={CalendarRange}
          tone="sky"
          value={nextSeven}
          sub="Including today"
        />
        <StatTile
          label="Scheduled"
          icon={CalendarDays}
          tone="solid"
          value={reviews.length}
          sub="All review dates"
        />
      </div>
      <div className="reviews-grid fill-page">
        <Card className="panel stack review-calendar reviews-week">
          <div className="section-heading">
            <SectionTitle icon={CalendarDays}>Review calendar</SectionTitle>
            {nav}
          </div>
          {grid}
          <section id="selected-review-day" className="stack reviews-agenda" aria-live="polite">
            <div className="section-heading">
              <h3>{dateLabel(selectedDate)}</h3>
              <span className="desk-count">
                {selected.length} {selected.length === 1 ? 'review' : 'reviews'}
              </span>
            </div>
            {selected.length ? (
              selected.map((review) => <ScheduledReview review={review} key={review.id} />)
            ) : (
              <p className="small muted">No reviews scheduled for this day.</p>
            )}
          </section>
        </Card>
        <Card className="panel reviews-overdue">
          <div className="section-heading">
            <h2 className="section-title">Overdue</h2>
            <span className="desk-count">{overdue.length}</span>
          </div>
          {overdue.length ? (
            <div className="stack">
              {overdue.map((review) => (
                <ScheduledReview review={review} key={review.id} />
              ))}
            </div>
          ) : (
            <p className="small muted">Nothing overdue. Reviews past their date appear here.</p>
          )}
        </Card>
      </div>
    </>
  );
}
