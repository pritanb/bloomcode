import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { NotebookPen } from 'lucide-react';
import type { Attempt, MistakeLabel } from '../shared/contracts';
import { api } from './api';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { dateLabel, Empty, ErrorNotice, Field, Loading, PageTitle, SectionTitle } from './ui';

const labels: { value: MistakeLabel; label: string }[] = [
  { value: 'missed_edge_case', label: 'Missed edge case' },
  { value: 'wrong_approach', label: 'Wrong approach' },
  { value: 'implementation_bug', label: 'Implementation bug' },
];

export function Mistakes() {
  const mountId = useId();
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState('');
  // A fresh server check on every visit prevents an older notebook cache from
  // revealing hints after a mixed assessment has begun.
  const query = useQuery({
    queryKey: ['mistakes', mountId, search, label],
    queryFn: () => api.get<Attempt[]>(`/mistakes?${new URLSearchParams({ q: search, ...(label ? { label } : {}) })}`),
    gcTime: 0,
    retry: false,
  });
  return <>
    <PageTitle title="Mistake notebook" description="Small lessons from past attempts, ready for your next practice session." />
    <Card className="panel">
      <SectionTitle icon={NotebookPen}>Find a lesson</SectionTitle>
      <div className="row history-filters">
        <Field label="Search questions and takeaways">
          <Input type="search" maxLength={300} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your notebook…" />
        </Field>
        <Field label="Mistake type">
          <SelectField value={label} onValueChange={setLabel}>
            <SelectOption value="">All mistakes</SelectOption>
            {labels.map(item => <SelectOption key={item.value} value={item.value}>{item.label}</SelectOption>)}
          </SelectField>
        </Field>
      </div>
      {query.isPending || query.isFetching ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : query.data.length ? <ul className="movement-list notebook-list">
        {query.data.map(attempt => <li key={attempt.id}>
          <div className="row between">
            <Link to={`/attempts/${attempt.id}`}>{attempt.problem.title}</Link>
            <span className="small muted">{dateLabel(attempt.finishedAt)}</span>
          </div>
          <div className="row">
            {(attempt.mistakeLabels ?? []).map(value => <Badge key={value} variant="secondary">{labels.find(item => item.value === value)?.label ?? value}</Badge>)}
          </div>
          {attempt.takeaway && <p className="preserve">{attempt.takeaway}</p>}
          <Link className="small" to={`/attempts/${attempt.id}`}>Open saved attempt</Link>
        </li>)}
      </ul> : <Empty>{search || label ? 'No lessons match these filters. Try another search or mistake type.' : 'After saving an attempt, add an optional mistake label or takeaway. Your lessons will appear here.'}</Empty>}
    </Card>
  </>;
}
