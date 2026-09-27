import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bug, Compass, NotebookPen, SearchX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Attempt, MistakeLabel } from '../../../shared/contracts';
import { api } from '../../app/api';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { dateLabel, ErrorNotice, Field, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  List,
  ListRow,
  PageHeader,
  Panel,
  ScrollRegion,
  ToneBadge,
  type Tone,
} from '../../components/kit';

const labels: { value: MistakeLabel; label: string }[] = [
  { value: 'missed_edge_case', label: 'Missed edge case' },
  { value: 'wrong_approach', label: 'Wrong approach' },
  { value: 'implementation_bug', label: 'Implementation bug' },
];
// Icon tile per first mistake label; an unlabelled lesson keeps the notebook icon.
const tiles: Record<string, { icon: LucideIcon; tone: Tone }> = {
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
  const count = query.data && !query.isFetching ? query.data.length : undefined;
  return (
    <>
      <PageHeader
        title="Mistake notebook"
        description="Small lessons from past attempts, ready for your next practice session."
      />
      <FillPage>
        <Panel
          className="min-h-0 flex-1"
          title="Lessons"
          icon={NotebookPen}
          tone="brand"
          meta={count !== undefined && `${count} ${count === 1 ? 'lesson' : 'lessons'}`}
        >
          <div className="grid items-end gap-3 min-[701px]:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
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
            <ScrollRegion>
              <List>
                {query.data.map((attempt) => {
                  const tile = tiles[attempt.mistakeLabels?.[0] ?? ''] ?? {
                    icon: NotebookPen,
                    tone: 'neutral',
                  };
                  return (
                    <ListRow
                      key={attempt.id}
                      icon={tile.icon}
                      tone={tile.tone}
                      className="first:pt-1"
                      title={attempt.problem.title}
                      to={`/attempts/${attempt.id}`}
                      trailing={
                        <span className="flex items-center gap-2">
                          {dateLabel(attempt.finishedAt)}
                          <span aria-hidden="true">·</span>
                          <Link
                            className="text-muted-foreground hover:text-foreground"
                            to={`/attempts/${attempt.id}`}
                          >
                            Open saved attempt
                          </Link>
                        </span>
                      }
                    >
                      {!!attempt.mistakeLabels?.length && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {attempt.mistakeLabels.map((value) => (
                            <ToneBadge key={value}>
                              {labels.find((item) => item.value === value)?.label ?? value}
                            </ToneBadge>
                          ))}
                        </div>
                      )}
                      {attempt.takeaway && (
                        <p className="mt-1 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                          {attempt.takeaway}
                        </p>
                      )}
                    </ListRow>
                  );
                })}
              </List>
            </ScrollRegion>
          ) : search || label ? (
            <EmptyState
              className="flex-1"
              icon={SearchX}
              title="No matching lessons"
              description="Try another search or mistake type."
            />
          ) : (
            <EmptyState
              className="flex-1"
              icon={NotebookPen}
              tone="brand"
              title="No lessons yet"
              description="Add a mistake label or takeaway after saving an attempt and it will appear here."
            />
          )}
        </Panel>
      </FillPage>
    </>
  );
}
