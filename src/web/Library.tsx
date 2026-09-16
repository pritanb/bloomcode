import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  History,
  Pencil,
  Play,
  Plus,
  Tags,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type {
  Problem,
  ProblemList,
  ProblemPage,
  Tag,
  Attempt,
  ReviewTarget,
} from '../shared/contracts';
import { api } from './api';
import {
  Icon,
  SectionTitle,
  AttemptList,
  dateLabel,
  duration,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  PageTitle,
  ResponsiveTable,
  TableCell,
  useAction,
} from './ui';
const filterOptions: Record<string, string[]> = {
  status: ['all', 'completed', 'attempted'],
  tagMode: ['any', 'all'],
  difficulty: ['', 'Easy', 'Medium', 'Hard'],
  timeBucket: ['', '0-10', '10-20', '20-30', '30-45', '45+', 'unknown'],
  sort: ['title', 'lastAttempt', 'solveTime', 'reviewDate', 'tagDifficulty'],
  direction: ['asc', 'desc'],
};
function useCatalogue() {
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  });
  const lists = useQuery({
    queryKey: ['lists'],
    queryFn: () => api.get<ProblemList[]>('/lists'),
  });
  return { tags, lists };
}
export function ProblemForm({
  problem,
  tags,
  lists,
  onSave,
  onCancel,
  pending,
  error,
}: {
  problem?: Problem;
  tags: Tag[];
  lists: ProblemList[];
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [title, setTitle] = useState(problem?.title ?? '');
  const [url, setUrl] = useState(problem?.url ?? '');
  const [difficulty, setDifficulty] = useState(problem?.difficulty ?? '');
  const [notes, setNotes] = useState(problem?.notes ?? '');
  const [selectedTags, setTags] = useState<Record<string, number | null>>(
    Object.fromEntries(problem?.tags.map((t) => [t.id, t.difficulty]) ?? []),
  );
  const [listIds, setListIds] = useState(problem?.lists.map((l) => l.id) ?? []);
  const [tagSearch, setTagSearch] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({
      title,
      ...(!problem ? { url } : {}),
      difficulty: difficulty || null,
      notes,
      tags: Object.entries(selectedTags).map(([tagId, difficulty]) => ({
        tagId,
        difficulty,
      })),
      listIds,
    });
  }
  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <Field label="Question title">
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="LeetCode URL">
          <Input
            type="url"
            required
            readOnly={!!problem}
            value={url}
            placeholder="https://leetcode.com/problems/…/"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label="LeetCode difficulty">
          <NativeSelect
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <NativeSelectOption value="">Unknown</NativeSelectOption>
            {['Easy', 'Medium', 'Hard'].map((v) => (
              <NativeSelectOption key={v}>{v}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Question notes">
        <Textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <fieldset>
        <legend>Pattern tags & question difficulty</legend>
        <p className="small muted">
          Optional difficulty per tag, from 1–10. This does not change your
          topic score.
        </p>
        <Field label="Find a tag">
          <Input
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
          />
        </Field>
        <div className="tag-choices">
          {tags
            .filter(
              (t) =>
                (!t.archived || t.id in selectedTags) &&
                t.name.toLowerCase().includes(tagSearch.toLowerCase()),
            )
            .map((t) => (
              <div className="tag-choice" key={t.id}>
                <Label>
                  <Checkbox
                    checked={t.id in selectedTags}
                    onCheckedChange={(checked) =>
                      setTags((old) => {
                        const next = { ...old };
                        if (checked === true) next[t.id] = null;
                        else delete next[t.id];
                        return next;
                      })
                    }
                  />
                  {t.name}
                  {t.archived ? ' (archived)' : ''}
                </Label>
                {t.id in selectedTags && (
                  <Input
                    aria-label={`${t.name} difficulty (1–10)`}
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    placeholder="Unknown"
                    value={selectedTags[t.id] ?? ''}
                    onChange={(e) =>
                      setTags({
                        ...selectedTags,
                        [t.id]:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            ))}
        </div>
        {!tags.length && (
          <p className="small muted">
            No tags yet. Create tags in Manage tags & lists.
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>List membership</legend>
        <div className="tag-choices">
          {lists.map((l) => (
            <Label className="check" key={l.id}>
              <Checkbox
                checked={listIds.includes(l.id)}
                onCheckedChange={(checked) =>
                  setListIds(
                    checked === true
                      ? [...listIds, l.id]
                      : listIds.filter((id) => id !== l.id),
                  )
                }
              />
              {l.name}
            </Label>
          ))}
        </div>
        {!lists.length && (
          <p className="small muted">
            No lists yet. Create a custom list in Manage tags & lists.
          </p>
        )}
      </fieldset>
      <ErrorNotice error={error} />
      <div className="row">
        <Button variant="default" disabled={pending}>
          {pending ? 'Saving…' : 'Save question'}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
const problemHeaders = [
  'Question',
  'Patterns',
  'Level',
  'Latest solve',
  'Next review',
] as const;
export function ProblemTable({ problems }: { problems: Problem[] }) {
  return (
    <ResponsiveTable headers={problemHeaders} className="problem-table">
      {problems.map((p) => (
        <TableRow role="row" key={p.id}>
          <TableCell label={problemHeaders[0]}>
            <Link className="problem-link" to={`/library/${p.id}`}>
              {p.title}
            </Link>
            <small>
              {p.lastOutcome === 'solved'
                ? 'Reported solved'
                : p.legacyCompleted
                  ? 'Legacy checklist completed'
                  : p.attemptCount
                    ? `${p.attemptCount} attempt${p.attemptCount === 1 ? '' : 's'}`
                    : 'Not attempted'}
            </small>
          </TableCell>
          <TableCell label={problemHeaders[1]}>
            <div className="chips">
              {p.tags.map((t) => (
                <Badge variant="secondary" key={t.id} className="chip">
                  {t.name}
                  {t.difficulty !== null ? ` ${t.difficulty}/10` : ''}
                </Badge>
              ))}
            </div>
          </TableCell>
          <TableCell label={problemHeaders[2]}>
            <Badge variant="secondary" className={`level ${p.difficulty?.toLowerCase()}`}>
              {p.difficulty ?? 'Unknown'}
            </Badge>
          </TableCell>
          <TableCell label={problemHeaders[3]}>
            {duration(p.lastSolveSeconds)}
            <small>
              {p.lastSolveHelp
                ? p.lastSolveHelp === 'none'
                  ? 'No help'
                  : `${p.lastSolveHelp} help`
                : 'Help unknown'}
            </small>
          </TableCell>
          <TableCell label={problemHeaders[4]}>
            {p.nextReviewDate ? dateLabel(p.nextReviewDate) : 'Not scheduled'}
          </TableCell>
        </TableRow>
      ))}
    </ResponsiveTable>
  );
}
export function Library() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { tags, lists } = useCatalogue();
  const queryParams = new URLSearchParams(params);
  if (!queryParams.has('page')) queryParams.set('page', '1');
  if (!queryParams.has('pageSize')) queryParams.set('pageSize', '25');
  const query = useQuery({
    queryKey: ['problems', queryParams.toString()],
    queryFn: () => api.get<ProblemPage>(`/problems?${queryParams}`),
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: true });
  }
  const add = useAction(async (data: Record<string, unknown>) => {
    const p = await api.send<Problem>('/problems', 'POST', data);
    setAdding(false);
    navigate(`/library/${p.id}`);
    return p;
  });
  return (
    <>
      <PageTitle
        title="Question library"
        description="Keep your questions, patterns and practice history together."
      >
        <div className="row">
          <Button asChild variant="outline"><Link  to="/library/manage">
            <Icon icon={Tags} />
            Manage tags & lists
          </Link></Button>
          <Button variant="default" onClick={() => setAdding(true)}>
            <Icon icon={Plus} />
            Add question
          </Button>
        </div>
      </PageTitle>
      {adding && (
        <Card className="panel editor-panel" aria-label="Add question">
          <SectionTitle icon={Plus}>Add a question</SectionTitle>
          <ProblemForm
            tags={tags.data ?? []}
            lists={lists.data ?? []}
            pending={add.isPending}
            error={add.error}
            onCancel={() => setAdding(false)}
            onSave={(data) => add.mutate(data)}
          />
        </Card>
      )}
      <Card className="panel filters">
        <Field label="Search questions">
          <Input
            type="search"
            placeholder="Search title or URL"
            value={params.get('search') ?? ''}
            onChange={(e) => filter('search', e.target.value)}
          />
        </Field>
        <div className="filter-grid">
          {[
            ['status', 'Practice status'],
            ['tagMode', 'Tag match'],
            ['difficulty', 'LeetCode level'],
            ['timeBucket', 'Solve time'],
            ['sort', 'Sort by'],
            ['direction', 'Sort direction'],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <NativeSelect
                value={params.get(key) ?? filterOptions[key][0]}
                onChange={(e) => filter(key, e.target.value)}
              >
                {filterOptions[key].map((v) => (
                  <NativeSelectOption key={v} value={v}>
                    {v || 'Any'}
                    {key === 'timeBucket' && v && v !== 'unknown' ? ' min' : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ))}
          <Field label="List">
            <NativeSelect
              value={params.get('listId') ?? ''}
              onChange={(e) => filter('listId', e.target.value)}
            >
              <NativeSelectOption value="">All lists</NativeSelectOption>
              {lists.data?.map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  {l.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Tag difficulty minimum">
            <Input
              type="number"
              min="1"
              max="10"
              value={params.get('tagDifficultyMin') ?? ''}
              onChange={(e) => filter('tagDifficultyMin', e.target.value)}
              placeholder="1"
            />
          </Field>
          <Field label="Tag difficulty maximum">
            <Input
              type="number"
              min="1"
              max="10"
              value={params.get('tagDifficultyMax') ?? ''}
              onChange={(e) => filter('tagDifficultyMax', e.target.value)}
              placeholder="10"
            />
          </Field>
        </div>
        <div className="row between">
          <div className="chips" aria-label="Filter by tags">
            {tags.data
              ?.filter((t) => !t.archived)
              .map((t) => {
                const selected = (params.get('tags') ?? '')
                  .split(',')
                  .filter(Boolean);
                return (
                  <Label
                    key={t.id}
                    className={`filter-chip ${selected.includes(t.id) ? 'selected' : ''}`}
                  >
                    <Checkbox
                      checked={selected.includes(t.id)}
                      onCheckedChange={(checked) =>
                        filter(
                          'tags',
                          (checked === true
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id)
                          ).join(','),
                        )
                      }
                    />
                    {t.name}
                  </Label>
                );
              })}
          </div>
          <Button variant="ghost" onClick={() => setParams({})}>
            Reset filters
          </Button>
        </div>
        <ErrorNotice
          error={tags.error ?? lists.error}
          retry={() => {
            void tags.refetch();
            void lists.refetch();
          }}
        />
      </Card>
      <Card className="panel library-results">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <div className="section-heading">
              <h2>
                {query.data.total} question{query.data.total === 1 ? '' : 's'}
              </h2>
              <span className="small muted">
                Times are self-reported. Unknown stays unknown.
              </span>
            </div>
            {query.data.items.length ? (
              <ProblemTable problems={query.data.items} />
            ) : (
              <Empty>
                <h3>No questions found</h3>
                <p>Add a question or reset your filters to see more.</p>
              </Empty>
            )}
            <div className="pagination">
              <Button variant="outline"
                disabled={query.data.page <= 1}
                onClick={() => filter('page', String(query.data.page - 1))}
              >
                Previous
              </Button>
              <span>Page {query.data.page}</span>
              <Button variant="outline"
                disabled={
                  query.data.page * query.data.pageSize >= query.data.total
                }
                onClick={() => filter('page', String(query.data.page + 1))}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
export function ReviewEditor({ review }: { review: ReviewTarget }) {
  const [action, setAction] = useState(review.action);
  const [date, setDate] = useState(review.effectiveDate ?? '');
  const save = useAction(() =>
    api.send<ReviewTarget>(`/reviews/${review.id}`, 'PATCH', {
      version: review.version,
      action,
      date: action === 'none' || action === 'recommended' ? null : date,
    }),
  );
  return (
    <form
      className="review-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="row">
        <Field label="Review scheduling">
          <NativeSelect
            value={action}
            onChange={(e) =>
              setAction(e.target.value as ReviewTarget['action'])
            }
          >
            <NativeSelectOption value="recommended">Use recommendation</NativeSelectOption>
            <NativeSelectOption value="manual">Choose date</NativeSelectOption>
            <NativeSelectOption value="snooze">Snooze until</NativeSelectOption>
            <NativeSelectOption value="none">No scheduled review</NativeSelectOption>
          </NativeSelect>
        </Field>
        {(action === 'manual' || action === 'snooze') && (
          <Field label="Review date">
            <Input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        )}
        <Button variant="outline" disabled={save.isPending}>Save review date</Button>
      </div>
      <p className="small muted">
        Recommended:{' '}
        {review.recommendedDate
          ? dateLabel(review.recommendedDate)
          : 'Not scheduled'}
        . {review.constraint ?? ''}
      </p>
      <ErrorNotice error={save.error} />
      {save.isSuccess && (
        <p role="status" className="positive">
          Review choice saved.
        </p>
      )}
    </form>
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
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
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
          <Button
            variant="default"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            <Icon icon={Play} />
            Start targeted practice
          </Button>
        </div>
      </PageTitle>
      <ErrorNotice error={start.error} />
      <Card className="panel">
        <div className="row between">
          <a href={p.url} target="_blank" rel="noreferrer">
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
            <p className="preserve">{p.notes || 'No question notes yet.'}</p>
            <div className="chips">
              {p.tags.map((t) => (
                <Badge variant="secondary" key={t.id} className="chip">
                  {t.name}
                  {t.difficulty !== null ? ` ${t.difficulty}/10` : ''}
                </Badge>
              ))}
              {p.lists.map((l) => (
                <Badge variant="secondary" className="badge" key={l.id}>
                  {l.name}
                </Badge>
              ))}
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
          <Empty>
            No review scheduled. You can choose a date when finishing an
            attempt.
          </Empty>
        )}
      </Card>
      <Card className="panel">
        <SectionTitle icon={History}>Practice history</SectionTitle>
        <AttemptList items={query.data.attempts} />
      </Card>
    </>
  );
}
