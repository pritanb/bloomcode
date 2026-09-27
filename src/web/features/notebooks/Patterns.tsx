import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Bookmark, BookOpen, ListChecks, SearchX, Tags } from 'lucide-react';
import type { PatternDetail, PatternEntry, PatternSummary } from '../../../shared/contracts';
import { api } from '../../app/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CopyButton, dateLabel, ErrorNotice, Field, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  IconTile,
  List,
  ListRow,
  PageHeader,
  Panel,
  ScrollRegion,
  SectionHeader,
} from '../../components/kit';

type Draft = Pick<PatternEntry, 'recognitionCues' | 'pitfalls' | 'notes'>;
type Recovery = { draft: Draft; version?: number };
const draftOf = (entry: PatternEntry): Draft => ({
  recognitionCues: entry.recognitionCues,
  pitfalls: entry.pitfalls,
  notes: entry.notes,
});
const storageKey = (id: string) => `leetcode-tutor:pattern-draft:${id}`;
function recovered(id: string): Recovery | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as Recovery | null;
    if (
      !value?.draft ||
      !['recognitionCues', 'pitfalls', 'notes'].every(
        (key) => typeof value.draft[key as keyof Draft] === 'string',
      )
    )
      return null;
    if (value.version !== undefined && (!Number.isInteger(value.version) || value.version < 1))
      return null;
    return {
      ...value,
      draft: {
        recognitionCues: value.draft.recognitionCues,
        pitfalls: value.draft.pitfalls,
        notes: value.draft.notes,
      },
    };
  } catch {
    return null;
  }
}

export function Patterns() {
  const mountId = useId();
  const [params, setParams] = useSearchParams();
  const selected = params.get('tag');
  const [search, setSearch] = useState('');
  const dirty = useRef(false);
  const list = useQuery({
    queryKey: ['patterns', mountId, search],
    queryFn: () => api.get<PatternSummary[]>(`/patterns?${new URLSearchParams({ q: search })}`),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const choose = (id: string | null) => {
    if (id === selected) return;
    if (
      dirty.current &&
      !window.confirm('Leave this unsaved pattern? A recovery draft will stay in this tab.')
    )
      return;
    dirty.current = false;
    setParams(id ? { tag: id } : {});
  };
  // Never display cached notebook content before a fresh server authorization
  // check. The server blocks these reads during active and paused mixed work.
  return (
    <>
      <PageHeader
        title="Pattern notebook"
        description="One notebook page for every tag. Tagged questions appear automatically."
        actions={
          <>
            <div className="w-[min(22rem,40vw)] max-[900px]:w-auto max-[900px]:flex-1 [&_label]:sr-only">
              <Field label="Search patterns">
                <Input
                  type="search"
                  maxLength={300}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search names, cues, pitfalls and notes…"
                />
              </Field>
            </div>
            <Button asChild variant="outline">
              <Link to="/library/manage">Manage tags</Link>
            </Button>
          </>
        }
      />
      {list.isPending || list.isFetching ? (
        <Loading />
      ) : list.isError ? (
        <ErrorNotice error={list.error} retry={() => void list.refetch()} />
      ) : (
        <FillPage className="grid grid-rows-[minmax(0,1fr)] gap-4 min-[701px]:grid-cols-[minmax(220px,0.65fr)_minmax(0,1.35fr)] max-[700px]:grid-rows-none">
          <Panel className="min-h-0" title="Your tags" icon={Tags} meta={String(list.data.length)}>
            {list.data.length ? (
              <ScrollRegion>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {list.data.map((entry) => {
                    const active = selected === entry.id;
                    return (
                      <li
                        key={entry.id}
                        className={cn(
                          'relative rounded-2xl px-1 pb-2.5 hover:bg-muted',
                          active &&
                            'bg-muted before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary',
                        )}
                      >
                        <Button
                          variant="ghost"
                          className={cn(
                            'h-auto w-full justify-start px-3 pt-2.5 pb-0.5 text-left text-[0.9375rem] font-medium whitespace-normal wrap-anywhere hover:bg-transparent dark:hover:bg-transparent',
                            active && 'font-semibold',
                          )}
                          aria-pressed={active}
                          onClick={() => choose(entry.id)}
                        >
                          {entry.title}
                        </Button>
                        <p className="px-3 text-[0.8125rem] text-muted-foreground tabular-nums">
                          {entry.archived ? 'Archived · ' : ''}
                          {entry.updatedAt
                            ? `Updated ${dateLabel(entry.updatedAt)}`
                            : 'No notebook notes yet'}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </ScrollRegion>
            ) : search ? (
              <EmptyState
                className="flex-1"
                icon={SearchX}
                title="No matching patterns"
                description="Try another search."
              />
            ) : (
              <EmptyState
                className="flex-1"
                icon={Tags}
                title="No tags yet"
                description="Create a tag in the library to start your notebook."
              />
            )}
          </Panel>
          {selected ? (
            <PatternSelection
              key={selected}
              id={selected}
              onDirty={(value) => {
                dirty.current = value;
              }}
              onSaved={() => {
                dirty.current = false;
                void list.refetch();
              }}
            />
          ) : (
            <Panel className="min-h-0">
              <EmptyState
                className="flex-1"
                icon={Bookmark}
                tone="brand"
                title="Pick a tag to open its page"
                description="Write recognition cues, pitfalls and notes for each pattern."
                action={
                  <Button asChild variant="outline">
                    <Link to="/library/manage">Manage tags</Link>
                  </Button>
                }
              />
            </Panel>
          )}
        </FillPage>
      )}
    </>
  );
}

function PatternSelection({
  id,
  onDirty,
  onSaved,
}: {
  id: string;
  onDirty: (value: boolean) => void;
  onSaved: (entry: PatternEntry) => void;
}) {
  const mountId = useId();
  const query = useQuery({
    queryKey: ['pattern', id, mountId],
    queryFn: () => api.get<PatternDetail>(`/patterns/${id}`),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return <PatternEditor id={id} initial={query.data} onDirty={onDirty} onSaved={onSaved} />;
}

function PatternEditor({
  id,
  initial,
  onDirty,
  onSaved,
}: {
  id: string;
  initial: PatternDetail;
  onDirty: (value: boolean) => void;
  onSaved: (entry: PatternEntry) => void;
}) {
  const [recovery] = useState(() => recovered(id));
  const [base, setBase] = useState<Draft>(() => draftOf(initial));
  const [draft, setDraft] = useState<Draft>(() => recovery?.draft ?? base);
  const [version, setVersion] = useState(recovery?.version ?? initial.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState(recovery ? 'Recovered unsaved changes from this tab.' : '');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const draftRef = useRef({ draft, version });
  draftRef.current = { draft, version };
  const remember = () => {
    try {
      sessionStorage.setItem(storageKey(id), JSON.stringify(draftRef.current));
    } catch {
      setStorageAvailable(false);
    }
  };
  useEffect(() => {
    onDirty(dirty || busy);
  }, [dirty, busy, onDirty]);
  useEffect(() => {
    if (dirty) remember();
    else {
      try {
        sessionStorage.removeItem(storageKey(id));
      } catch {
        /* Saved content remains on the server. */
      }
    }
  }, [draft, dirty, version]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !anchor ||
        anchor.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (!window.confirm('Leave this unsaved pattern? A recovery draft will stay in this tab.')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty, busy]);
  const change = (key: keyof Draft, value: string) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setStatus('');
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const payload = { ...draft, ...(version === undefined ? {} : { version }) };
    remember();
    try {
      const saved = await api.send<PatternEntry>(`/patterns/${id}`, 'PATCH', payload);
      setBase(draftOf(saved));
      setDraft(draftOf(saved));
      setVersion(saved.version);
      try {
        sessionStorage.removeItem(storageKey(id));
      } catch {
        /* Server save succeeded. */
      }
      setStatus('Pattern saved.');
      onSaved(saved);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!window.confirm('Discard your unsaved changes and reload the saved pattern?')) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.get<PatternDetail>(`/patterns/${id}`);
      const next = draftOf(saved);
      setBase(next);
      setDraft(next);
      setVersion(saved.version);
      try {
        sessionStorage.removeItem(storageKey(id));
      } catch {
        /* The editor has been reset. */
      }
      setStatus('Loaded the saved pattern.');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const refreshVersion = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.get<PatternDetail>(`/patterns/${id}`);
      setBase(draftOf(saved));
      setVersion(saved.version);
      setStatus('Latest saved version loaded. Your unsaved changes are kept; save to apply them.');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="min-h-0">
      <div className="flex items-start gap-3.5">
        <IconTile icon={BookOpen} tone="brand" />
        <div className="flex min-w-0 flex-col">
          <h2 className="font-heading text-[1.0625rem] leading-10 font-semibold tracking-[-0.01em] wrap-anywhere">
            {initial.title}
            {initial.archived ? ' (archived)' : ''}
          </h2>
          {initial.description && (
            <p className="-mt-1 text-[0.9375rem] whitespace-pre-wrap text-muted-foreground wrap-anywhere">
              {initial.description}
            </p>
          )}
        </div>
      </div>
      <ScrollRegion className="flex flex-col gap-6">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label="Recognition cues">
            <Textarea
              rows={3}
              maxLength={1000000}
              value={draft.recognitionCues}
              disabled={busy}
              onChange={(event) => change('recognitionCues', event.target.value)}
              placeholder="What in a question suggests this pattern?"
            />
          </Field>
          <Field label="Common pitfalls">
            <Textarea
              rows={3}
              maxLength={1000000}
              value={draft.pitfalls}
              disabled={busy}
              onChange={(event) => change('pitfalls', event.target.value)}
              placeholder="What do you tend to miss?"
            />
          </Field>
          <Field label="Your notes">
            <Textarea
              rows={4}
              maxLength={1000000}
              value={draft.notes}
              disabled={busy}
              onChange={(event) => change('notes', event.target.value)}
              placeholder="A checklist, explanation or small example in your own words"
            />
          </Field>
          <ErrorNotice error={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save pattern'}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void discard()}>
                Discard changes
              </Button>
            )}
            <span className="ml-1 text-[0.8125rem] text-muted-foreground" role="status">
              {dirty ? 'Unsaved changes' : status}
            </span>
          </div>
          {!!error && (
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                text={`${initial.title}\n\nRecognition cues\n${draft.recognitionCues}\n\nPitfalls\n${draft.pitfalls}\n\nNotes\n${draft.notes}`}
              >
                Copy unsaved pattern
              </CopyButton>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void refreshVersion()}
              >
                Refresh saved version, keep my changes
              </Button>
            </div>
          )}
          {status && dirty && (
            <p className="text-[0.8125rem] text-muted-foreground" role="status">
              {status}
            </p>
          )}
          {recovery && dirty && (
            <p className="text-[0.8125rem] text-muted-foreground">
              Recovered changes stay in this tab until you save.
            </p>
          )}
          {!storageAvailable && dirty && (
            <p role="alert" className="text-[0.8125rem]">
              This browser could not keep a recovery draft. Save or copy your notes before leaving.
            </p>
          )}
        </form>
        <section
          className="flex flex-col gap-3 border-t pt-5"
          aria-label="Questions with this pattern"
        >
          <SectionHeader
            level={3}
            icon={ListChecks}
            title="Questions with this pattern"
            meta={String(initial.examples.length)}
          />
          <p className="-mt-1 text-[0.8125rem] text-muted-foreground">
            Assign or remove this pattern when editing a question in your library.
          </p>
          {initial.examples.length ? (
            <List>
              {initial.examples.map((problem) => (
                <ListRow
                  key={problem.id}
                  className="py-3"
                  title={problem.title}
                  to={`/library/${problem.id}`}
                />
              ))}
            </List>
          ) : (
            <EmptyState
              className="py-8"
              title="No questions yet"
              description="Tagged questions appear here automatically."
            />
          )}
          <Button asChild variant="outline" className="self-start">
            <Link to={`/library?tags=${encodeURIComponent(id)}`}>View in question library</Link>
          </Button>
        </section>
      </ScrollRegion>
    </Panel>
  );
}
