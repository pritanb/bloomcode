import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bug, Compass, NotebookPen, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Attempt, MistakeLabel } from '../shared/contracts';
import { api } from './api';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { dateLabel, Empty, ErrorNotice, Field, Icon, Loading, PageTitle } from './ui';

const labels: { value: MistakeLabel; label: string }[] = [
  { value: 'missed_edge_case', label: 'Missed edge case' },
  { value: 'wrong_approach', label: 'Wrong approach' },
  { value: 'implementation_bug', label: 'Implementation bug' },
];
// Icon tile per first mistake label; an unlabelled lesson keeps the notebook icon.
const tiles: Record<string, { icon: LucideIcon; tone: string }> = {
  missed_edge_case: { icon: TriangleAlert, tone: 'amber' },
  wrong_approach: { icon: Compass, tone: 'rose' },
  implementation_bug: { icon: Bug, tone: 'sky' },
};

export function Mistakes() {
  const mountId = useId();
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState('');
  // A fresh server check on every visit prevents an older notebook cache from
  // revealing hints after a mixed assessment has begun.
  const query = useQuery({
    queryKey: ['mistakes', mountId, search, label],
    queryFn: () =>
      api.get<Attempt[]>(
        `/mistakes?${new URLSearchParams({ q: search, ...(label ? { label } : {}) })}`,
      ),
    gcTime: 0,
    retry: false,
  });
  return (
    <>
      <PageTitle
        title="Mistake notebook"
        description="Small lessons from past attempts, ready for your next practice session."
      />
      <Card className="panel fill-page mistakes-panel">
        <div className="section-heading">
          <h2 className="section-title">Lessons</h2>
          {query.data && !query.isFetching && (
            <span className="desk-count">
              {query.data.length} {query.data.length === 1 ? 'lesson' : 'lessons'}
            </span>
          )}
        </div>
        <div className="mistake-filters">
          <Field label="Search questions and takeaways">
            <Input
              type="search"
              maxLength={300}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your notebook…"
            />
          </Field>
          <Field label="Mistake type">
            <SelectField value={label} onValueChange={setLabel}>
              <SelectOption value="">All mistakes</SelectOption>
              {labels.map((item) => (
                <SelectOption key={item.value} value={item.value}>
                  {item.label}
                </SelectOption>
              ))}
            </SelectField>
          </Field>
        </div>
        {query.isPending || query.isFetching ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : query.data.length ? (
          <ul className="movement-list notebook-list mistake-list">
            {query.data.map((attempt) => {
              const tile = tiles[attempt.mistakeLabels?.[0] ?? ''] ?? {
                icon: NotebookPen,
                tone: 'muted',
              };
              return (
                <li key={attempt.id}>
                  <span className={`nb-tile tone-${tile.tone}`} aria-hidden="true">
                    <Icon icon={tile.icon} />
                  </span>
                  <div className="mistake-body">
                    <Link className="mistake-title" to={`/attempts/${attempt.id}`}>
                      {attempt.problem.title}
                    </Link>
                    {!!attempt.mistakeLabels?.length && (
                      <div className="row mistake-labels">
                        {attempt.mistakeLabels.map((value) => (
                          <Badge key={value} variant="secondary">
                            {labels.find((item) => item.value === value)?.label ?? value}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {attempt.takeaway && (
                      <p className="preserve mistake-takeaway">{attempt.takeaway}</p>
                    )}
                  </div>
                  <div className="mistake-meta">
                    <span>{dateLabel(attempt.finishedAt)}</span>
                    <Link to={`/attempts/${attempt.id}`}>Open saved attempt</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>
            {search || label ? (
              <>
                <h3>No matching lessons</h3>
                <p>Try another search or mistake type.</p>
              </>
            ) : (
              <>
                <h3>No lessons yet</h3>
                <p>
                  Add a mistake label or takeaway after saving an attempt and it will appear here.
                </p>
              </>
            )}
          </Empty>
        )}
      </Card>
    </>
  );
}
