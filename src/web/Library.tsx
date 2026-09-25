import { Dialog } from 'radix-ui';
import { tagColour } from './tag-colour';
import { enumLabel, helpLabel, languageLabel } from './labels';
import { DateField } from '@/components/date-field';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft,
  ChevronDown,
  CalendarDays,
  ExternalLink,
  History,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  Problem,
  ProblemList,
  ProblemPage,
  Tag,
  Attempt,
  ReviewTarget,
} from '../shared/contracts';
import { api, ApiError } from './api';
import {
  Icon,
  SectionTitle,
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
// The library opens on the most recent practice; the API keeps its own title order.
const defaultSort = 'lastAttempt';
const defaultDirection = 'desc';
const filterOptions: Record<string, string[]> = {
  status: ['all', 'solved', 'not_solved', 'stopped', 'not_submitted'],
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
  const [leetcodeTopics, setLeetcodeTopics] = useState((problem?.leetcodeTopics ?? []).join(', '));
  const [selectedTags, setTags] = useState<Record<string, number | null>>(
    Object.fromEntries(problem?.tags.map((t) => [t.id, t.difficulty]) ?? []),
  );
  const [listIds, setListIds] = useState(problem?.lists.map((l) => l.id) ?? []);
  const [tagSearch, setTagSearch] = useState('');
  const createPattern = useAction(async () => {
    const tag = await api.send<Tag>('/tags', 'POST', { name: tagSearch.trim() });
    setTags((old) => ({ ...old, [tag.id]: null }));
    setTagSearch('');
    return tag;
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const enteredTopics = leetcodeTopics
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean);
    onSave({
      title,
      ...(!problem ? { url } : {}),
      difficulty: difficulty || null,
      notes,
      leetcodeTopics: enteredTopics,
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
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
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
          <SelectField value={difficulty} onValueChange={(value) => setDifficulty(value)}>
            <SelectOption value="">Unknown</SelectOption>
            {['Easy', 'Medium', 'Hard'].map((v) => (
              <SelectOption key={v}>{v}</SelectOption>
            ))}
          </SelectField>
        </Field>
      </div>
      <Field label="LeetCode topics">
        <Input
          value={leetcodeTopics}
          onChange={(event) => setLeetcodeTopics(event.target.value)}
          placeholder="Binary Search, Array"
        />
      </Field>
      <p className="small muted">
        Optional additional categories, separated by commas. Each tag below has its own notebook
        page.
      </p>
      <Field label="Question notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <fieldset>
        <legend>Tags & question difficulty</legend>
        <p className="small muted">
          Optional difficulty per pattern, from 1–10. This does not change your topic score.
        </p>
        <Field label="Find or create a tag">
          <Input maxLength={300} value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} />
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
                  <span className="tag-colour tag-label" style={tagColour(t)}>
                    {t.name}
                  </span>
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
                        [t.id]: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            ))}
        </div>
        {tagSearch.trim() &&
          !tags.some((tag) => tag.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
            <Button
              type="button"
              variant="outline"
              disabled={createPattern.isPending || pending}
              onClick={() => createPattern.mutate()}
            >
              Create tag “{tagSearch.trim()}”
            </Button>
          )}
        <ErrorNotice error={createPattern.error} />
        {!tags.length && (
          <p className="small muted">
            Create a tag to group questions and keep shared notebook notes.
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
                    checked === true ? [...listIds, l.id] : listIds.filter((id) => id !== l.id),
                  )
                }
              />
              {l.name}
            </Label>
          ))}
        </div>
        {!lists.length && (
          <p className="small muted">No lists yet. Create a custom list in Manage tags & lists.</p>
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
const outcomeTone = (outcome: string | null | undefined) =>
  outcome === 'solved' ? 'up' : outcome === 'not_solved' ? 'warn' : '';
const problemHeaders = [
  'Question',
  'Tags',
  'Difficulty',
  'Latest submission',
  'LeetCode time',
  'Confidence',
  'Next review',
  'Attempt notes',
] as const;
const problemSortKeys: Record<string, string> = {
  Question: 'title',
  Tags: 'tagDifficulty',
  Difficulty: 'difficulty',
  'Latest submission': 'lastAttempt',
  'LeetCode time': 'solveTime',
  Confidence: 'confidence',
  'Next review': 'reviewDate',
};
export function ProblemTable({
  problems,
  sort = 'title',
  direction = 'asc',
  onSort,
}: {
  problems: Problem[];
  sort?: string;
  direction?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}) {
  return (
    <ResponsiveTable
      headers={problemHeaders}
      className={`problem-table${onSort ? ' sortable-table' : ''}`}
      sorting={
        onSort
          ? {
              active:
                Object.keys(problemSortKeys).find((header) => problemSortKeys[header] === sort) ??
                '',
              direction,
              onSort: (header) => onSort(problemSortKeys[header]),
              labels: {
                Question: 'question title',
                Tags: 'tag difficulty',
                Difficulty: 'difficulty',
                'Latest submission': 'last attempt',
                'LeetCode time': 'solve time',
                Confidence: 'confidence',
                'Next review': 'next review',
              },
            }
          : undefined
      }
    >
      {problems.map((p) => (
        <TableRow role="row" key={p.id}>
          <TableCell label={problemHeaders[0]}>
            <div className="problem-cell">
              <Link className="problem-link" to={`/library/${p.id}`} title={`Open ${p.title}`}>
                {p.title}
              </Link>
            </div>
          </TableCell>
          <TableCell label={problemHeaders[1]}>
            <div className="chips" aria-label="Tags">
              {p.tags.map((t) => (
                <Badge
                  variant="secondary"
                  key={t.id}
                  style={tagColour(t)}
                  title={`${t.name}${t.difficulty !== null ? ` ${t.difficulty}/10` : ''}`}
                  className="tag-colour chip library-tag"
                >
                  <Link to={`/patterns?tag=${encodeURIComponent(t.id)}`}>
                    {t.name}
                    {t.difficulty !== null ? ` ${t.difficulty}/10` : ''}
                  </Link>
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
            {p.latestSubmission ? (
              <>
                <Link
                  className={outcomeTone(p.latestSubmission.outcome)}
                  to={`/attempts/${p.latestSubmission.id}`}
                >
                  {enumLabel(p.latestSubmission.outcome)}
                </Link>
                <small>
                  {helpLabel(p.latestSubmission.help)} ·{' '}
                  {languageLabel(p.latestSubmission.language)}
                </small>
                <small>{dateLabel(p.latestSubmission.finishedAt)}</small>
              </>
            ) : (
              'Not submitted'
            )}
          </TableCell>
          <TableCell label={problemHeaders[4]}>
            {duration(p.latestSubmission?.activeSeconds ?? null)}
          </TableCell>
          <TableCell label={problemHeaders[5]}>
            {p.latestConfidence != null ? `${p.latestConfidence} / 5` : 'Not rated'}
            {p.latestSubmission?.confidence == null && p.latestConfidence != null && (
              <small>Earlier submission</small>
            )}
          </TableCell>
          <TableCell label={problemHeaders[6]}>
            {p.nextReviewDate ? dateLabel(p.nextReviewDate) : 'Not scheduled'}
            {p.reviewAction && p.reviewAction !== 'none' && (
              <small>
                {p.reviewAction === 'manual'
                  ? 'Chosen date'
                  : p.reviewAction === 'snooze'
                    ? 'Snoozed'
                    : 'Recommended'}
              </small>
            )}
          </TableCell>
          <TableCell label={problemHeaders[7]}>
            {p.latestSubmission?.notes ? (
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <Button variant="link" className="h-auto p-0">
                    View notes
                  </Button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="notes-dialog-overlay" />
                  <Dialog.Content className="notes-dialog">
                    <Dialog.Title>Attempt notes</Dialog.Title>
                    <Dialog.Description className="muted">{p.title}</Dialog.Description>
                    <div className="notes-dialog-body preserve">{p.latestSubmission.notes}</div>
                    <Dialog.Close asChild>
                      <Button variant="outline">Close</Button>
                    </Dialog.Close>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            ) : (
              'No notes'
            )}
          </TableCell>
        </TableRow>
      ))}
    </ResponsiveTable>
  );
}
const libraryFiltersKey = 'library-filters';
export function Library() {
  const [params, setParams] = useSearchParams();
  // A bare /library visit (e.g. from the sidebar) brings back the filters last used this session;
  // links that carry their own filters take precedence.
  const [restoring, setRestoring] = useState(() => {
    if (params.size > 0) return false;
    try {
      return !!sessionStorage.getItem(libraryFiltersKey);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (restoring) {
      try {
        setParams(new URLSearchParams(sessionStorage.getItem(libraryFiltersKey) ?? ''), {
          replace: true,
        });
      } catch {
        /* Start with default filters. */
      }
      setRestoring(false);
      return;
    }
    try {
      sessionStorage.setItem(libraryFiltersKey, params.toString());
    } catch {
      /* Filters still live in the URL. */
    }
  }, [params, restoring, setParams]);
  // Older library links used overlapping practice-history filters.
  useEffect(() => {
    const status = params.get('status');
    if (status !== 'completed' && status !== 'attempted' && status !== 'unsolved') return;
    const next = new URLSearchParams(params);
    next.set(
      'status',
      status === 'completed' ? 'solved' : status === 'unsolved' ? 'not_submitted' : 'all',
    );
    next.set('page', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [tagsOpen, setTagsOpen] = useState(false);
  const selectedTags = (params.get('tags') ?? '').split(',').filter(Boolean);
  const activeFilters = [...params.entries()].filter(
    ([key, value]) =>
      ![
        'page',
        'pageSize',
        'search',
        'sort',
        'direction',
        'tagDifficultyMin',
        'tagDifficultyMax',
      ].includes(key) &&
      value &&
      value !== (filterOptions[key]?.[0] ?? ''),
  ).length;
  const hasFilters = activeFilters > 0 || !!params.get('search');
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const { tags, lists } = useCatalogue();
  const queryParams = new URLSearchParams(params);
  queryParams.delete('tagDifficultyMin');
  queryParams.delete('tagDifficultyMax');
  if (!queryParams.has('page')) queryParams.set('page', '1');
  if (!queryParams.has('pageSize')) queryParams.set('pageSize', storedPageSize());
  if (!queryParams.has('sort')) queryParams.set('sort', defaultSort);
  if (!queryParams.has('direction')) queryParams.set('direction', defaultDirection);
  const query = useQuery({
    queryKey: ['problems', queryParams.toString()],
    queryFn: () => api.get<ProblemPage>(`/problems?${queryParams}`),
    enabled: !restoring,
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('tagDifficultyMin');
    next.delete('tagDifficultyMax');
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
          <Button asChild variant="outline">
            <Link to="/library/manage">
              <Icon icon={Tags} />
              Manage tags & lists
            </Link>
          </Button>
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
      <Card className="panel library-results fill-page">
        <div className="section-heading">
          <h2 className="section-title">
            {query.isSuccess
              ? `${query.data.total} question${query.data.total === 1 ? '' : 's'}`
              : 'Questions'}
          </h2>
        </div>
        <div className="library-toolbar">
          <div className="library-search">
            <Input
              type="search"
              aria-label="Search questions"
              placeholder="Search questions by title or URL…"
              value={params.get('search') ?? ''}
              onChange={(e) => filter('search', e.target.value)}
            />
          </div>
          <Button
            variant={filtersOpen ? 'secondary' : 'outline'}
            aria-expanded={filtersOpen}
            aria-controls="library-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <Icon icon={SlidersHorizontal} />
            Filters
            {activeFilters > 0 && (
              <span className="filter-count" aria-label={`${activeFilters} active`}>
                {activeFilters}
              </span>
            )}
          </Button>
          {hasFilters && (
            <Button variant="ghost" onClick={() => setParams({})}>
              Reset filters
            </Button>
          )}
        </div>
        <div id="library-filters" className="library-filter-details" hidden={!filtersOpen}>
          <div className="library-filter-grid">
            <Field label="LeetCode topic">
              <Input
                value={params.get('leetcodeTopic') ?? ''}
                onChange={(event) => filter('leetcodeTopic', event.target.value)}
                placeholder="e.g. Binary Search"
              />
            </Field>
            <Field label="Latest submission">
              <SelectField
                value={params.get('status') ?? 'all'}
                onValueChange={(value) => filter('status', value)}
              >
                <SelectOption value="all">All questions</SelectOption>
                <SelectOption value="solved">Solved</SelectOption>
                <SelectOption value="not_solved">Not solved</SelectOption>
                <SelectOption value="stopped">Stopped</SelectOption>
                <SelectOption value="not_submitted">Not submitted</SelectOption>
              </SelectField>
            </Field>
            <Field label="Difficulty">
              <SelectField
                value={params.get('difficulty') ?? ''}
                onValueChange={(value) => filter('difficulty', value)}
              >
                <SelectOption value="">All difficulties</SelectOption>
                {['Easy', 'Medium', 'Hard'].map((level) => (
                  <SelectOption key={level}>{level}</SelectOption>
                ))}
              </SelectField>
            </Field>
            <div className="field">
              <Label htmlFor="tag-filter-trigger">Tags</Label>
              <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                <PopoverTrigger asChild>
                  <Button id="tag-filter-trigger" variant="outline" className="tag-filter-trigger">
                    {selectedTags.length ? `${selectedTags.length} selected` : 'All tags'}
                    <Icon icon={ChevronDown} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="tag-filter-popover"
                  align="start"
                  sideOffset={6}
                  aria-label="Filter by patterns"
                >
                  <Input
                    aria-label="Find a pattern"
                    placeholder="Find a pattern…"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                  />
                  <div className="tag-filter-options">
                    {tags.data
                      ?.filter(
                        (t) =>
                          !t.archived && t.name.toLowerCase().includes(tagSearch.toLowerCase()),
                      )
                      .map((t) => (
                        <Label className="tag-filter-option" key={t.id}>
                          <Checkbox
                            checked={selectedTags.includes(t.id)}
                            onCheckedChange={(checked) =>
                              filter(
                                'tags',
                                (checked === true
                                  ? [...selectedTags, t.id]
                                  : selectedTags.filter((id) => id !== t.id)
                                ).join(','),
                              )
                            }
                          />
                          <span className="tag-colour tag-label" style={tagColour(t)}>
                            {t.name}
                          </span>
                        </Label>
                      ))}
                    {tags.data &&
                      !tags.data.some(
                        (t) =>
                          !t.archived && t.name.toLowerCase().includes(tagSearch.toLowerCase()),
                      ) && <p className="muted">No matching tags.</p>}
                  </div>
                  <div className="tag-filter-actions">
                    <SelectField
                      aria-label="Match selected patterns"
                      value={params.get('tagMode') ?? 'any'}
                      onValueChange={(value) => filter('tagMode', value)}
                    >
                      <SelectOption value="any">Match any pattern</SelectOption>
                      <SelectOption value="all">Match all patterns</SelectOption>
                    </SelectField>
                    <Button
                      variant="ghost"
                      disabled={!selectedTags.length}
                      onClick={() => filter('tags', '')}
                    >
                      Clear
                    </Button>
                    <Button variant="outline" onClick={() => setTagsOpen(false)}>
                      Done
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Field label="List">
              <SelectField
                value={params.get('listId') ?? ''}
                onValueChange={(value) => filter('listId', value)}
              >
                <SelectOption value="">All lists</SelectOption>
                {lists.data?.map((l) => (
                  <SelectOption key={l.id} value={l.id}>
                    {l.name}
                  </SelectOption>
                ))}
              </SelectField>
            </Field>
            <Field label="Solve time">
              <SelectField
                value={params.get('timeBucket') ?? ''}
                onValueChange={(value) => filter('timeBucket', value)}
              >
                {filterOptions.timeBucket.map((value) => (
                  <SelectOption key={value} value={value}>
                    {value === '' ? 'Any time' : value === 'unknown' ? 'Unknown' : `${value} min`}
                  </SelectOption>
                ))}
              </SelectField>
            </Field>
            <Field label="Attempt confidence">
              <SelectField
                value={params.get('confidence') ?? ''}
                onValueChange={(value) => filter('confidence', value)}
                title="Latest recorded confidence rating"
              >
                <SelectOption value="">Any confidence</SelectOption>
                <SelectOption value="low">Low (below 3)</SelectOption>
                <SelectOption value="medium">Medium (3 to under 4)</SelectOption>
                <SelectOption value="high">High (4–5)</SelectOption>
                <SelectOption value="unknown">Not recorded</SelectOption>
              </SelectField>
            </Field>
          </div>
        </div>
        {params.get('confidence') && (
          <p className="small muted library-note">
            Uses your latest recorded rating, not a topic score. Unrated attempts keep the earlier
            rating; “Not recorded” means none was saved.
          </p>
        )}
        <ErrorNotice
          error={tags.error ?? lists.error}
          retry={() => {
            void tags.refetch();
            void lists.refetch();
          }}
        />
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {query.data.items.length ? (
              <ProblemTable
                problems={query.data.items}
                sort={params.get('sort') ?? defaultSort}
                direction={
                  (params.get('direction') ?? defaultDirection) === 'desc' ? 'desc' : 'asc'
                }
                onSort={(sort) => {
                  const next = new URLSearchParams(params);
                  next.set('sort', sort);
                  next.set(
                    'direction',
                    (params.get('sort') ?? defaultSort) === sort &&
                      (params.get('direction') ?? defaultDirection) === 'asc'
                      ? 'desc'
                      : 'asc',
                  );
                  next.set('page', '1');
                  setParams(next, { replace: true });
                }}
              />
            ) : (
              <Empty>
                <h3>
                  {params.get('confidence')
                    ? 'No questions match this confidence filter'
                    : 'No questions found'}
                </h3>
                {params.get('confidence') ? (
                  <>
                    <p>Only the latest recorded rating is used. Other active filters also apply.</p>
                    <Button variant="outline" onClick={() => filter('confidence', '')}>
                      Clear confidence filter
                    </Button>
                  </>
                ) : (
                  <p>Add a question or reset your filters to see more.</p>
                )}
              </Empty>
            )}
            <div className="pagination">
              <span className="small muted pagination-range">
                {query.data.total
                  ? `${(query.data.page - 1) * query.data.pageSize + 1}–${Math.min(query.data.page * query.data.pageSize, query.data.total)} of ${query.data.total}`
                  : '0 of 0'}
              </span>
              <div className="pagination-size small muted">
                <span aria-hidden="true">Per page</span>
                <SelectField
                  aria-label="Questions per page"
                  value={String(query.data.pageSize)}
                  onValueChange={(value) => {
                    try {
                      localStorage.setItem(pageSizeKey, value);
                    } catch {
                      /* The URL still carries the size. */
                    }
                    filter('pageSize', value);
                  }}
                >
                  {pageSizes.map((size) => (
                    <SelectOption key={size} value={String(size)}>
                      {size}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
              <Button
                variant="outline"
                disabled={query.data.page <= 1}
                onClick={() => filter('page', String(query.data.page - 1))}
              >
                Previous
              </Button>
              <span>
                Page {query.data.page} of{' '}
                {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}
              </span>
              <Button
                variant="outline"
                disabled={query.data.page * query.data.pageSize >= query.data.total}
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
const pageSizeKey = 'library-page-size';
const pageSizes = [25, 50, 100];
function storedPageSize() {
  try {
    const stored = localStorage.getItem(pageSizeKey);
    if (stored && pageSizes.includes(Number(stored))) return stored;
  } catch {
    /* Fall back to the default size. */
  }
  return '25';
}
export function ReviewEditor({ review }: { review: ReviewTarget }) {
  const cache = useQueryClient();
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
          <SelectField
            value={action}
            onValueChange={(value) => setAction(value as ReviewTarget['action'])}
          >
            <SelectOption value="recommended">Use recommendation</SelectOption>
            <SelectOption value="manual">Choose date</SelectOption>
            <SelectOption value="snooze">Snooze until</SelectOption>
            <SelectOption value="none">No scheduled review</SelectOption>
          </SelectField>
        </Field>
        {(action === 'manual' || action === 'snooze') && (
          <Field label="Review date">
            <DateField required value={date} onValueChange={setDate} />
          </Field>
        )}
        <Button variant="outline" disabled={save.isPending}>
          Save review date
        </Button>
      </div>
      <p className="small muted">
        Recommended: {review.recommendedDate ? dateLabel(review.recommendedDate) : 'Not scheduled'}.{' '}
        {review.constraint ?? ''}
      </p>
      <ErrorNotice error={save.error} />
      {save.error instanceof ApiError && save.error.status === 409 && (
        <div className="stack">
          <p className="small">
            This schedule changed elsewhere. Reload its latest choice before rescheduling.
          </p>
          <Button type="button" variant="outline" onClick={() => void cache.invalidateQueries()}>
            Reload latest schedule
          </Button>
        </div>
      )}
      {save.isSuccess && (
        <p role="status" className="positive">
          Review choice saved.
        </p>
      )}
    </form>
  );
}
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
function AttemptHistory({ items }: { items: Attempt[] }) {
  const ordered = [...items].sort(
    (a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) ||
      b.id.localeCompare(a.id),
  );
  if (!ordered.length)
    return <Empty>No practice recorded yet. Start a question to save your first attempt.</Empty>;
  return (
    <ol className="movement-list attempt-history">
      {ordered.map((a, index) => (
        <li key={a.id}>
          <div className="attempt-history-body">
            <div className="row between">
              <h3>
                Attempt {ordered.length - index}
                <span className="small muted"> · {dateLabel(a.finishedAt ?? a.startedAt)}</span>
              </h3>
              <Link className="small" to={`/attempts/${a.id}`}>
                Open saved attempt
              </Link>
            </div>
            <div className="chips">
              <Badge variant="secondary" className={`outcome-badge ${outcomeTone(a.outcome)}`}>
                {enumLabel(a.outcome ?? a.status)}
              </Badge>
              <Badge variant="secondary">{duration(a.activeSeconds)}</Badge>
              <Badge variant="secondary">{helpLabel(a.help)}</Badge>
              <Badge variant="secondary">{enumLabel(a.evidence)}</Badge>
              {a.confidence !== null && (
                <Badge variant="secondary">Confidence {a.confidence}/5</Badge>
              )}
              {(a.mistakeLabels ?? []).map((label) => (
                <Badge variant="secondary" key={label}>
                  {enumLabel(label)}
                </Badge>
              ))}
            </div>
            <div className="attempt-history-columns">
              <section className="attempt-history-notes" aria-label="Attempt notes">
                <h4>Attempt notes</h4>
                {a.notes ? (
                  <p className="preserve">{a.notes}</p>
                ) : (
                  <p className="muted">No notes recorded.</p>
                )}
                {a.takeaway && (
                  <div className="attempt-history-takeaway">
                    <h4>Takeaway</h4>
                    <p className="preserve">{a.takeaway}</p>
                  </div>
                )}
              </section>
              <section className="attempt-history-feedback" aria-label="Tutor note">
                <h4>Tutor note</h4>
                {a.feedback ? (
                  <p className="preserve">{a.feedback}</p>
                ) : (
                  <p className="muted">
                    {a.status === 'completed'
                      ? 'No tutor note for this attempt.'
                      : 'Attempt in progress.'}
                  </p>
                )}
              </section>
            </div>
          </div>
        </li>
      ))}
    </ol>
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
                        <Link to={`/patterns?tag=${encodeURIComponent(t.id)}`}>
                          {t.name}
                          {t.difficulty !== null ? ` ${t.difficulty}/10` : ''}
                        </Link>
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
