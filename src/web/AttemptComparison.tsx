import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Attempt } from '../shared/contracts';
import { api } from './api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { dateLabel, duration, ErrorNotice, Loading } from './ui';
import { enumLabel, helpLabel, languageLabel } from './labels';

export function previousAttempt(current: Attempt, history: Attempt[]): Attempt | undefined {
  const ordered = [current, ...history.filter(a => a.id !== current.id && a.problemId === current.problemId && a.status === 'completed')]
    .sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) || b.id.localeCompare(a.id));
  return ordered[ordered.findIndex(a => a.id === current.id) + 1];
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
  return <Card className="panel">
    <Button type="button" variant="ghost" aria-expanded={open} aria-controls={`comparison-${attempt.id}`} onClick={() => setOpen(value => !value)}>Compare with previous attempt</Button>
    {open && <div id={`comparison-${attempt.id}`}>
      {query.isPending || query.isFetching ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : previous ? <div className="attempt-comparison-grid">
        {[previous, attempt].map((item, index) => <section className="stack" key={item.id} aria-label={index ? 'This attempt' : 'Previous attempt'}>
          <h3>{index ? 'This attempt' : 'Previous attempt'}</h3>
          <p className="small muted">{dateLabel(item.finishedAt ?? item.startedAt)} · {enumLabel(item.outcome)}</p>
          <p>{duration(item.activeSeconds)} · {helpLabel(item.help)}</p>
          <p className="preserve">{item.notes || 'No notes recorded.'}</p>
          <p className="small muted">{languageLabel(item.language)}</p>
          <pre className="comparison-code" tabIndex={0}><code>{item.code || 'No code recorded.'}</code></pre>
        </section>)}
      </div> : <p className="muted">This is your first completed attempt for this question.</p>}
    </div>}
  </Card>;
}
