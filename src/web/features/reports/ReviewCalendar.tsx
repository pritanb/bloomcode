import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarCheck,
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
import { Disclosure } from '@/components/disclosure';
import { ReviewEditor } from '../library/ReviewEditor';
import { dateLabel, ErrorNotice, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  List,
  ListRow,
  Panel,
  ScrollRegion,
  SectionHeader,
  StatTile,
} from '../../components/kit';
import { cn } from '@/lib/utils';
import { statRow, statTile } from './stat-row';

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
    <ListRow
      title={review.problemTitle}
      to={`/library/${review.problemId}`}
      meta={
        <>
          {review.action === 'manual'
            ? 'Chosen date'
            : review.action === 'snooze'
              ? 'Snoozed'
              : 'Recommended'}{' '}
          · {dateLabel(review.effectiveDate)}
        </>
      }
    >
      <Disclosure quiet title={`Reschedule ${review.problemTitle}`}>
        <div className="mb-1 flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <p className="text-[0.8125rem] text-muted-foreground">
            Changing this date keeps any question already assigned to your current plan.
          </p>
          <ReviewEditor key={`${review.id}-${review.version}`} review={review} />
        </div>
      </Disclosure>
    </ListRow>
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
    <div className="-mr-2 flex items-center gap-0.5 [&_[data-slot=button]]:text-muted-foreground [&_[data-slot=button]:hover]:text-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Previous week"
        onClick={() => setWeekOffset((value) => value - 1)}
      >
        <ChevronLeft aria-hidden="true" />
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
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
  const grid = (
    <div className="grid shrink-0 grid-cols-7 gap-1 xl:gap-2">
      {days.map((day, index) => {
        const count = reviews.filter((review) => review.effectiveDate === day).length;
        const selected = index === selectedIndex;
        return (
          <Button
            type="button"
            variant={selected ? 'default' : 'ghost'}
            className={cn(
              'h-auto min-w-0 flex-col gap-1 px-0 py-2.5 font-normal tabular-nums',
              selected ? 'hover:bg-primary' : 'bg-muted hover:bg-accent',
            )}
            key={day}
            aria-pressed={selected}
            aria-controls="selected-review-day"
            aria-label={`${dateLabel(day)}, ${count} ${count === 1 ? 'review' : 'reviews'}`}
            onClick={() => setSelectedIndex(index)}
          >
            <span className="text-xs">
              {day === today
                ? 'Today'
                : new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(
                    new Date(`${day}T12:00:00Z`),
                  )}
            </span>
            <span className="text-[1.0625rem] leading-6 font-semibold">
              {Number(day.slice(-2))}
            </span>
            <span
              className={cn(
                'text-xs',
                selected ? 'text-primary-foreground/70' : 'text-muted-foreground',
              )}
            >
              {count}
            </span>
          </Button>
        );
      })}
    </div>
  );
  const selected = reviews.filter((review) => review.effectiveDate === selectedDate);
  if (compact)
    return (
      <Panel title="Review calendar" icon={CalendarDays} actions={nav} className="shrink-0 gap-3.5">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {grid}
            <div
              id="selected-review-day"
              className="flex items-center justify-between gap-3 text-[0.8125rem] text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              <span>
                {dateLabel(selectedDate)} · {selected.length} reviews
              </span>
              <Link
                to="/reviews"
                className={cn(
                  'inline-flex items-center gap-1 font-medium',
                  overdue.length ? 'text-warn' : 'text-foreground',
                )}
              >
                {overdue.length > 0 ? `${overdue.length} overdue` : 'All reviews'}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </>
        )}
      </Panel>
    );
  if (query.isPending || query.isError)
    return (
      <Panel title="Review calendar" icon={CalendarDays}>
        {query.isPending ? (
          <Loading />
        ) : (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        )}
      </Panel>
    );
  const thisWeek = reviewWeek(timezone);
  const dueToday = reviews.filter((review) => review.effectiveDate === today).length;
  const nextSeven = reviews.filter(
    (review) => review.effectiveDate! >= today && review.effectiveDate! <= thisWeek[6],
  ).length;
  return (
    <FillPage>
      <div className={statRow}>
        <StatTile
          className={statTile}
          label="Overdue"
          icon={CalendarX2}
          tone="rose"
          value={overdue.length}
          sub={
            overdue.length ? (
              <span className="font-medium text-warn">Reschedule or practise</span>
            ) : (
              'All caught up'
            )
          }
        />
        <StatTile
          className={statTile}
          label="Due today"
          icon={CalendarClock}
          tone="amber"
          value={dueToday}
          sub={dateLabel(today)}
        />
        <StatTile
          className={statTile}
          label="Next 7 days"
          icon={CalendarRange}
          tone="sky"
          value={nextSeven}
          sub="Including today"
        />
        <StatTile
          className={statTile}
          label="Scheduled"
          icon={CalendarDays}
          tone="solid"
          value={reviews.length}
          sub="All review dates"
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <Panel title="Review calendar" icon={CalendarDays} actions={nav} className="min-h-0">
          {grid}
          <section
            id="selected-review-day"
            className="flex min-h-0 flex-1 flex-col gap-1"
            aria-live="polite"
          >
            <SectionHeader
              level={3}
              title={dateLabel(selectedDate)}
              meta={`${selected.length} ${selected.length === 1 ? 'review' : 'reviews'}`}
              className="border-b pt-1 pb-3 [&_h3]:text-[0.9375rem]"
            />
            <ScrollRegion>
              {selected.length ? (
                <List>
                  {selected.map((review) => (
                    <ScheduledReview review={review} key={review.id} />
                  ))}
                </List>
              ) : (
                <p className="py-3.5 text-[0.8125rem] text-muted-foreground">
                  No reviews scheduled for this day.
                </p>
              )}
            </ScrollRegion>
          </section>
        </Panel>
        <Panel
          title="Overdue"
          icon={CalendarX2}
          meta={overdue.length}
          scroll
          bodyClassName="gap-0"
          className="min-h-0 gap-2"
        >
          {overdue.length ? (
            <List>
              {overdue.map((review) => (
                <ScheduledReview review={review} key={review.id} />
              ))}
            </List>
          ) : (
            <EmptyState
              icon={CalendarCheck}
              title="Nothing overdue"
              description="Reviews past their date appear here."
              className="mt-2"
            />
          )}
        </Panel>
      </div>
    </FillPage>
  );
}
