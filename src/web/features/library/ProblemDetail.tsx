import { tagColour } from '../../lib/tag-colour';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ArrowLeft, CalendarDays, ExternalLink, History, Pencil, Play } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Problem, Attempt, ReviewTarget } from '../../../shared/contracts';
import { api } from '../../app/api';
import {
  Icon,
  SectionTitle,
  dateLabel,
  Empty,
  ErrorNotice,
  Loading,
  PageTitle,
  useAction,
} from '../../components/ui';
import { AttemptHistory } from './AttemptHistory';
import { useCatalogue } from './library-utils';
import { ProblemForm } from './ProblemForm';
import { ReviewEditor } from './ReviewEditor';

// Tutor notes are appended to the question notes over time, each led by its date.
const notedEntry = /^(\d{4}-\d{2}-\d{2}) tutor note:\s*/;
function QuestionNotes({ notes }: { notes: string }) {
  const entries = notes
    .split(/\n\s*\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) return <p className="small muted">No question notes yet.</p>;
  return (
    <div className="question-notes">
      {entries.map((entry, index) => {
        const dated = notedEntry.exec(entry);
        return (
          <div key={index}>
            {dated && <p className="small muted">Tutor note · {dateLabel(dated[1])}</p>}
            <p className="preserve">{dated ? entry.slice(dated[0].length) : entry}</p>
          </div>
        );
      })}
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
  return (
    <>
      <Link className="back-link" to="/library">
        <Icon icon={ArrowLeft} />
        Back to library
      </Link>
      <PageTitle
        title={p.title}
        description="Library-selected practice is targeted, not a hidden assessment."
      >
        <div className="row">
          <Button variant="outline" onClick={() => setEditing(!editing)}>
            <Icon icon={Pencil} />
            Edit question
          </Button>
          <Button variant="default" disabled={start.isPending} onClick={() => start.mutate()}>
            <Icon icon={Play} />
            Start targeted practice
          </Button>
        </div>
      </PageTitle>
      <ErrorNotice error={start.error} />
      <div className="problem-detail-layout fill-page">
        <div className="problem-detail-side">
          <Card className="panel problem-summary">
            <div className="row between">
              <a className="problem-source" href={p.url} target="_blank" rel="noreferrer">
                <Icon icon={ExternalLink} />
                Open in LeetCode
              </a>
              <Badge variant="secondary" className={`level ${p.difficulty?.toLowerCase()}`}>
                {p.difficulty ?? 'Unknown difficulty'}
              </Badge>
            </div>
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
              <>
                <div className="problem-fact">
                  <h3>Question notes</h3>
                  <QuestionNotes notes={p.notes} />
                </div>
                <div className="problem-fact">
                  <h3>LeetCode topics</h3>
                  <p>{p.leetcodeTopics?.join(', ') || 'No additional topics recorded.'}</p>
                </div>
                <div className="problem-fact">
                  <h3>Tags</h3>
                  <div className="chips">
                    {p.tags.map((t) => (
                      <Badge
                        variant="secondary"
                        key={t.id}
                        style={tagColour(t)}
                        className="tag-colour chip"
                      >
                        <Link to={`/patterns?tag=${encodeURIComponent(t.id)}`}>{t.name}</Link>
                      </Badge>
                    ))}
                    {!p.tags.length && <p className="small muted">No tags assigned.</p>}
                  </div>
                </div>
                <div className="problem-fact">
                  <h3>Lists</h3>
                  <div className="chips">
                    {p.lists.map((l) => (
                      <Badge variant="secondary" className="badge" key={l.id}>
                        {l.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>
          <Card className="panel">
            <SectionTitle icon={CalendarDays}>Review schedule</SectionTitle>
            {query.data.reviews.length ? (
              query.data.reviews.map((r) => (
                <ReviewEditor key={`${r.id}-${r.version}`} review={r} />
              ))
            ) : (
              <Empty>No review scheduled. You can choose a date when finishing an attempt.</Empty>
            )}
          </Card>
        </div>
        <Card className="panel problem-history">
          <div className="section-heading">
            <SectionTitle icon={History}>Practice history</SectionTitle>
            <span className="desk-count">
              {query.data.attempts.length} attempt{query.data.attempts.length === 1 ? '' : 's'}
            </span>
          </div>
          <AttemptHistory items={query.data.attempts} />
        </Card>
      </div>
    </>
  );
}
