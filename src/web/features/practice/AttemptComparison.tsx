import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Attempt } from '../../../shared/contracts';
import { api } from '../../app/api';
import { Button } from '@/components/ui/button';
import { ChevronDown, GitCompareArrows } from 'lucide-react';
import { dateLabel, duration, ErrorNotice, Loading } from '../../components/ui';
import { Callout, IconTile, panelClass, Subheading } from '../../components/kit';
import { cn } from '@/lib/utils';
import { enumLabel, helpLabel, languageLabel } from '../../lib/labels';

export function previousAttempt(current: Attempt, history: Attempt[]): Attempt | undefined {
  const ordered = [
    current,
    ...history.filter(
      (a) => a.id !== current.id && a.problemId === current.problemId && a.status === 'completed',
    ),
  ].sort(
    (a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) ||
      b.id.localeCompare(a.id),
  );
  return ordered[ordered.findIndex((a) => a.id === current.id) + 1];
}

export function AttemptComparison({ attempt }: { attempt: Attempt }) {
  const [open, setOpen] = useState(false);
  const mountId = useId();
  const query = useQuery({
    queryKey: ['attempt-comparison', attempt.id, mountId],
    queryFn: () => api.get<{ history: Attempt[] }>(`/attempts/${attempt.id}/context`),
    enabled: open && attempt.status === 'completed',
    staleTime: 0,
    gcTime: 0,
  });
  if (attempt.status !== 'completed') return null;
  const previous = query.data && previousAttempt(attempt, query.data.history);
  return (
    <section className={cn(panelClass, 'gap-0 p-2')}>
      <Button
        type="button"
        variant="ghost"
        className="group h-auto w-full justify-between rounded-2xl px-4 py-3.5 font-heading text-[1.0625rem] font-semibold tracking-[-0.01em]"
        aria-expanded={open}
        aria-controls={`comparison-${attempt.id}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2.5">
          <IconTile icon={GitCompareArrows} size="sm" />
          Compare with previous attempt
        </span>
        <ChevronDown
          className="text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
          focusable="false"
        />
      </Button>
      {open && (
        <div id={`comparison-${attempt.id}`} className="px-4 pt-2 pb-4">
          {query.isPending || query.isFetching ? (
            <Loading />
          ) : query.isError ? (
            <ErrorNotice error={query.error} retry={() => void query.refetch()} />
          ) : previous ? (
            <div className="grid gap-6 md:grid-cols-2">
              {[previous, attempt].map((item, index) => (
                <section
                  className="flex min-w-0 flex-col gap-3"
                  key={item.id}
                  aria-label={index ? 'This attempt' : 'Previous attempt'}
                >
                  <div className="flex flex-col gap-0.5">
                    <Subheading>{index ? 'This attempt' : 'Previous attempt'}</Subheading>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {dateLabel(item.finishedAt ?? item.startedAt)} · {enumLabel(item.outcome)}
                    </p>
                  </div>
                  <p className="font-medium tabular-nums">
                    {duration(item.activeSeconds)} · {helpLabel(item.help)}
                  </p>
                  <p className="whitespace-pre-wrap wrap-anywhere">
                    {item.notes || 'No notes recorded.'}
                  </p>
                  {item.feedback && (
                    <Callout label="Tutor note" className="whitespace-pre-wrap wrap-anywhere">
                      {item.feedback}
                    </Callout>
                  )}
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {languageLabel(item.language)}
                  </p>
                  <pre
                    className="max-h-104 overflow-auto rounded-2xl bg-muted p-4 font-mono text-[0.8125rem] leading-relaxed"
                    tabIndex={0}
                  >
                    <code>{item.code || 'No code recorded.'}</code>
                  </pre>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              This is your first completed attempt for this question.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
