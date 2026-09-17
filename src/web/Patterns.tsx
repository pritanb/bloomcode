import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import type { PatternDetail, PatternEntry, PatternSummary } from '../shared/contracts';
import { api } from './api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton, dateLabel, Empty, ErrorNotice, Field, Loading, PageTitle, SectionTitle } from './ui';

type Draft = Pick<PatternEntry, 'recognitionCues' | 'pitfalls' | 'notes'>;
type Recovery = { draft: Draft; version?: number };
const draftOf = (entry: PatternEntry): Draft => ({ recognitionCues: entry.recognitionCues, pitfalls: entry.pitfalls, notes: entry.notes });
const storageKey = (id: string) => `leetcode-tutor:pattern-draft:${id}`;
function recovered(id: string): Recovery | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as Recovery | null;
    if (!value?.draft || !['recognitionCues', 'pitfalls', 'notes'].every(key => typeof value.draft[key as keyof Draft] === 'string')) return null;
    if (value.version !== undefined && (!Number.isInteger(value.version) || value.version < 1)) return null;
    return { ...value, draft: { recognitionCues: value.draft.recognitionCues, pitfalls: value.draft.pitfalls, notes: value.draft.notes } };
  } catch { return null; }
}

export function Patterns() {
  const mountId = useId();
  const [params, setParams] = useSearchParams();
  const selected = params.get('tag');
  const [search, setSearch] = useState('');
  const dirty = useRef(false);
  const list = useQuery({
    queryKey: ['patterns', mountId, search], queryFn: () => api.get<PatternSummary[]>(`/patterns?${new URLSearchParams({ q: search })}`),
    gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const choose = (id: string | null) => {
    if (id === selected) return;
    if (dirty.current && !window.confirm('Leave this unsaved pattern? A recovery draft will stay in this tab.')) return;
    dirty.current = false;
    setParams(id ? { tag: id } : {});
  };
  // Never display cached notebook content before a fresh server authorization
  // check. The server blocks these reads during active and paused mixed work.
  return <>
    <PageTitle title="Pattern notebook" description="One notebook page for every tag. Tagged questions appear automatically.">
      <Button asChild variant="outline"><Link to="/library/manage">Manage tags</Link></Button>
    </PageTitle>
    <Field label="Search patterns"><Input type="search" maxLength={300} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names, cues, pitfalls and notes…" /></Field>
    {list.isPending || list.isFetching ? <Loading /> : list.isError ? <ErrorNotice error={list.error} retry={() => void list.refetch()} /> : <div className="notebook-layout">
      <Card className="panel notebook-index">
        <SectionTitle icon={BookOpen}>Your tags</SectionTitle>
        {list.data.length ? <ul className="movement-list">
          {list.data.map(entry => <li key={entry.id}>
            <Button variant={selected === entry.id ? 'secondary' : 'ghost'} className="notebook-entry-button" aria-pressed={selected === entry.id} onClick={() => choose(entry.id)}>{entry.title}</Button>
            <p className="small muted">{entry.archived ? 'Archived · ' : ''}{entry.updatedAt ? `Updated ${dateLabel(entry.updatedAt)}` : 'No notebook notes yet'}</p>
          </li>)}
        </ul> : <Empty>{search ? 'No patterns match this search.' : 'Create a tag in the library to start your notebook.'}</Empty>}
      </Card>
      {selected ? <PatternSelection key={selected} id={selected} onDirty={value => { dirty.current = value; }} onSaved={() => { dirty.current = false; void list.refetch(); }} /> : <Card className="panel"><Empty>Select a tag to write its recognition cues, pitfalls and notes.</Empty><Button asChild variant="outline"><Link to="/library/manage">Manage tags</Link></Button></Card>}

    </div>}
  </>;
}

function PatternSelection({ id, onDirty, onSaved }: { id: string; onDirty: (value: boolean) => void; onSaved: (entry: PatternEntry) => void }) {
  const mountId = useId();
  const query = useQuery({ queryKey: ['pattern', id, mountId], queryFn: () => api.get<PatternDetail>(`/patterns/${id}`), gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return <PatternEditor id={id} initial={query.data} onDirty={onDirty} onSaved={onSaved} />;
}

function PatternEditor({ id, initial, onDirty, onSaved }: { id: string; initial: PatternDetail; onDirty: (value: boolean) => void; onSaved: (entry: PatternEntry) => void }) {
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
    try { sessionStorage.setItem(storageKey(id), JSON.stringify(draftRef.current)); }
    catch { setStorageAvailable(false); }
  };
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => {
    if (dirty) remember();
    else { try { sessionStorage.removeItem(storageKey(id)); } catch { /* Saved content remains on the server. */ } }
  }, [draft, dirty, version]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm('Leave this unsaved pattern? A recovery draft will stay in this tab.')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, busy]);
  const change = (key: keyof Draft, value: string) => { setDraft(old => ({ ...old, [key]: value })); setStatus(''); };
  const save = async () => {
    setBusy(true); setError(null);
    const payload = { ...draft, ...(version === undefined ? {} : { version }) };
    remember();
    try {
      const saved = await api.send<PatternEntry>(`/patterns/${id}`, 'PATCH', payload);
      setBase(draftOf(saved)); setDraft(draftOf(saved)); setVersion(saved.version);
      try { sessionStorage.removeItem(storageKey(id)); } catch { /* Server save succeeded. */ }
      setStatus('Pattern saved.'); onSaved(saved);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!window.confirm('Discard your unsaved changes and reload the saved pattern?')) return;
    setBusy(true); setError(null);
    try {
      const saved = await api.get<PatternDetail>(`/patterns/${id}`);
      const next = draftOf(saved);
      setBase(next); setDraft(next); setVersion(saved.version);
      try { sessionStorage.removeItem(storageKey(id)); } catch { /* The editor has been reset. */ }
      setStatus('Loaded the saved pattern.');
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  const refreshVersion = async () => {
    setBusy(true); setError(null);
    try {
      const saved = await api.get<PatternDetail>(`/patterns/${id}`);
      setBase(draftOf(saved)); setVersion(saved.version);
      setStatus('Latest saved version loaded. Your unsaved changes are kept; save to apply them.');
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  return <Card className="panel notebook-editor">
    <SectionTitle icon={BookOpen}>{initial.title}{initial.archived ? ' (archived)' : ''}</SectionTitle>
    {initial.description && <p className="muted preserve">{initial.description}</p>}
    <form className="stack" onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="Recognition cues"><Textarea rows={3} maxLength={1000000} value={draft.recognitionCues} disabled={busy} onChange={event => change('recognitionCues', event.target.value)} placeholder="What in a question suggests this pattern?" /></Field>
      <Field label="Common pitfalls"><Textarea rows={3} maxLength={1000000} value={draft.pitfalls} disabled={busy} onChange={event => change('pitfalls', event.target.value)} placeholder="What do you tend to miss?" /></Field>
      <Field label="Your notes"><Textarea rows={4} maxLength={1000000} value={draft.notes} disabled={busy} onChange={event => change('notes', event.target.value)} placeholder="A checklist, explanation or small example in your own words" /></Field>
      <ErrorNotice error={error} />
      <div className="row"><Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save pattern'}</Button>{dirty && <Button type="button" variant="ghost" disabled={busy} onClick={() => void discard()}>Discard changes</Button>}<span className="small muted" role="status">{dirty ? 'Unsaved changes' : status}</span></div>
      {!!error && <div className="row"><CopyButton text={`${initial.title}\n\nRecognition cues\n${draft.recognitionCues}\n\nPitfalls\n${draft.pitfalls}\n\nNotes\n${draft.notes}`}>Copy unsaved pattern</CopyButton><Button type="button" variant="outline" disabled={busy} onClick={() => void refreshVersion()}>Refresh saved version, keep my changes</Button></div>}
      {status && dirty && <p className="small muted" role="status">{status}</p>}
      {recovery && dirty && <p className="small muted">Recovered changes stay in this tab until you save.</p>}
      {!storageAvailable && dirty && <p role="alert" className="small">This browser could not keep a recovery draft. Save or copy your notes before leaving.</p>}
    </form>
    <section className="stack" aria-label="Questions with this pattern">
      <h3>Questions with this pattern</h3>
      <p className="small muted">Assign or remove this pattern when editing a question in your library.</p>
      {initial.examples.length ? <ul className="movement-list">{initial.examples.map(problem => <li key={problem.id} className="row between">
        <Link to={`/library/${problem.id}`}>{problem.title}</Link>
        <span className="small muted">{problem.patternDifficulty === null ? 'Pattern difficulty not set' : `Pattern difficulty ${problem.patternDifficulty}/10`}</span>
      </li>)}</ul> : <Empty>No questions carry this pattern yet.</Empty>}
      <Button asChild variant="outline"><Link to={`/library?tags=${encodeURIComponent(id)}`}>View in question library</Link></Button>
    </section>
  </Card>;
}
