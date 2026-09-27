import { Button } from '@/components/ui/button';
import { CalendarDays, ExternalLink, FileText, History, Pencil, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { Problem, Attempt, ReviewTarget } from '../../../shared/contracts';
import { api } from '../../app/api';
import { dateLabel, ErrorNotice, Loading, useAction } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  PageHeader,
  Panel,
  ScrollRegion,
  ToneBadge,
} from '../../components/kit';
import { BackLink } from '../../components/back-link';
import { AttemptHistory } from './AttemptHistory';
import { useCatalogue } from './library-utils';
import { ProblemForm } from './ProblemForm';
import { ReviewEditor } from './ReviewEditor';
import { DifficultyBadge, TagBadge } from './tags';

const quiet = 'text-[0.8125rem] text-muted-foreground';

// Tutor notes are appended to the question notes over time, each led by its date.
const notedEntry = /^(\d{4}-\d{2}-\d{2}) tutor note:\s*/;
function QuestionNotes({ notes }: { notes: string }) {
  const entries = notes
    .split(/\n\s*\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) return <p className={quiet}>No question notes yet.</p>;
  return (
    <div className="flex flex-col divide-y">
      {entries.map((entry, index) => {
        const dated = notedEntry.exec(entry);
        return (
          <div key={index} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            {dated && <p className={quiet}>Tutor note · {dateLabel(dated[1])}</p>}
            <p className="whitespace-pre-wrap wrap-anywhere">
              {dated ? entry.slice(dated[0].length) : entry}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <h3 className="text-[0.8125rem] font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function ProblemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const { tags, lists } = useCatalogue();
  const query = useQuery({
    queryKey: ['problem', id],
    queryFn: () =>
      api.get<{
        problem: Problem;
        attempts: Attempt[];
        reviews: ReviewTarget[];
      }>(`/problems/${id}`),
  });
  const edit = useAction(async (data: Record<string, unknown>) => {
    const p = await api.send<Problem>(`/problems/${id}`, 'PATCH', data);
    setEditing(false);
    return p;
  });
  const start = useAction(async () => {
    const a = await api.send<Attempt>('/attempts', 'POST', {
      problemId: id,
      context: 'targeted',
      language: 'python',
    });
    navigate(`/attempts/${a.id}`);
    return a;
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  const p = query.data.problem;
  const attempts = query.data.attempts.length;
  return (
    <>
      <BackLink to="/library">Back to library</BackLink>
      <PageHeader
        title={p.title}
        description="Library-selected practice is targeted, not a hidden assessment."
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(!editing)}>
              <Pencil aria-hidden="true" />
              Edit question
            </Button>
            <Button variant="default" disabled={start.isPending} onClick={() => start.mutate()}>
              <Play aria-hidden="true" />
              Start targeted practice
            </Button>
          </>
        }
      />
      <ErrorNotice error={start.error} />
      <FillPage className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:grid-rows-[minmax(0,1fr)]">
        <ScrollRegion className="flex flex-col gap-4">
          <Panel
            title="Question"
            icon={FileText}
            tone="sky"
            actions={<DifficultyBadge difficulty={p.difficulty} unknown="Unknown difficulty" />}
          >
            <a
              className="-mt-1 inline-flex items-center gap-2 self-start font-medium text-foreground"
              href={p.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
              Open in LeetCode
            </a>
            <div className="border-t pt-4">
              {editing ? (
                <ProblemForm
                  key={p.id}
                  problem={p}
                  tags={tags.data ?? []}
                  lists={lists.data ?? []}
                  onSave={(data) => edit.mutate(data)}
                  onCancel={() => setEditing(false)}
                  pending={edit.isPending}
                  error={edit.error ?? tags.error ?? lists.error}
                />
              ) : (
                <div className="flex flex-col divide-y text-[0.9375rem]">
                  <Fact title="Question notes">
                    <QuestionNotes notes={p.notes} />
                  </Fact>
                  <Fact title="LeetCode topics">
                    {p.leetcodeTopics?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {p.leetcodeTopics.map((topic) => (
                          <ToneBadge key={topic} tone="muted" wrap>
                            {topic}
                          </ToneBadge>
                        ))}
                      </div>
                    ) : (
                      <p className={quiet}>No additional topics recorded.</p>
                    )}
                  </Fact>
                  <Fact title="Tags">
                    <div className="flex flex-wrap gap-1.5">
                      {p.tags.map((t) => (
                        <TagBadge key={t.id} tag={t} />
                      ))}
                      {!p.tags.length && <p className={quiet}>No tags assigned.</p>}
                    </div>
                  </Fact>
                  <Fact title="Lists">
                    <div className="flex flex-wrap gap-1.5">
                      {p.lists.map((l) => (
                        <ToneBadge key={l.id}>{l.name}</ToneBadge>
                      ))}
                    </div>
                  </Fact>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Review schedule" icon={CalendarDays} tone="amber">
            {query.data.reviews.length ? (
              <div className="flex flex-col divide-y">
                {query.data.reviews.map((r) => (
                  <div key={`${r.id}-${r.version}`} className="py-4 first:pt-0 last:pb-0">
                    <ReviewEditor review={r} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                className="py-6"
                icon={CalendarDays}
                title="No review scheduled"
                description="You can choose a date when finishing an attempt."
              />
            )}
          </Panel>
        </ScrollRegion>
        <Panel
          scroll
          className="min-h-0 max-lg:flex-1"
          title="Practice history"
          icon={History}
          tone="emerald"
          meta={`${attempts} attempt${attempts === 1 ? '' : 's'}`}
        >
          <AttemptHistory items={query.data.attempts} />
        </Panel>
      </FillPage>
    </>
  );
}
