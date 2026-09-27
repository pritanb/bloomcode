import { enumLabel, helpLabel, languageLabel } from '../../lib/labels';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { useDarkMode } from '../../app/theme';
import { SelectField, SelectOption } from '@/components/select-field';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CodeXml,
  ExternalLink,
  Flag,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import type { Attempt, Help, Outcome } from '../../../shared/contracts';
import { api, ApiError } from '../../app/api';
import { AttemptQueue } from './attemptQueue';
import { AttemptComparison } from './AttemptComparison';
import { AttemptReflection } from './AttemptReflection';
import { TutorReport } from './TutorReport';
import { CopyButton, dateLabel, duration, ErrorNotice, Field, Loading } from '../../components/ui';
import {
  IconTile,
  List,
  ListRow,
  PageHeader,
  Panel,
  ScrollRegion,
  SectionHeader,
} from '../../components/kit';
import { cn } from '@/lib/utils';
type Draft = Pick<Attempt, 'code' | 'notes' | 'language'>;
const sameDraft = (a: Draft, b: Draft) =>
  a.code === b.code && a.notes === b.notes && a.language === b.language;
export function AttemptPage() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['attempt', id],
    queryFn: () => api.get<Attempt>(`/attempts/${id}`),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return <AttemptWorkspace key={query.data.id} initial={query.data} />;
}
function AttemptWorkspace({ initial }: { initial: Attempt }) {
  const dark = useDarkMode();
  const cache = useQueryClient();
  const [attempt, setAttempt] = useState(initial);
  const [draft, setDraft] = useState<Draft>({
    code: initial.code,
    notes: initial.notes,
    language: initial.language,
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [queue] = useState(() => new AttemptQueue(initial));
  const [error, setError] = useState<unknown>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const run = useCallback(
    async (operation: (a: Attempt) => Promise<Attempt>) => {
      const execute = async () => {
        try {
          const saved = await queue.run(operation);
          setAttempt(saved);
          setError(null);
        } catch (e) {
          setError(e);
          throw e;
        }
      };
      retryRef.current = async () => {
        queue.clearError();
        await execute();
      };
      return execute();
    },
    [queue],
  );
  const saveDraft = useCallback(async () => {
    const snapshot = { ...draftRef.current };
    setSaving(true);
    try {
      await run((a) =>
        a.status === 'completed' || sameDraft(a, snapshot)
          ? Promise.resolve(a)
          : api.send<Attempt>(`/attempts/${a.id}/draft`, 'PATCH', {
              version: a.version,
              ...snapshot,
            }),
      );
    } catch {
      /* Error is visible; edits stay in memory. */
    } finally {
      setSaving(false);
    }
  }, [run]);
  useEffect(() => {
    if (attempt.status === 'completed' || submitting || error || sameDraft(attempt, draft)) return;
    const id = window.setTimeout(() => void saveDraft(), 650);
    return () => window.clearTimeout(id);
  }, [draft, attempt, submitting, error, saveDraft]);
  const dirty = !sameDraft(attempt, draft);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || saving || submitting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving, submitting]);
  const extensions = [
    EditorView.lineWrapping,
    ...(draft.language === 'python' ? [python()] : draft.language === 'java' ? [java()] : []),
  ];
  async function retry() {
    if (retryRef.current)
      try {
        await retryRef.current();
      } catch {
        /* visible */
      }
  }
  async function reloadSaved() {
    try {
      const saved = await api.get<Attempt>(`/attempts/${attempt.id}`);
      queue.current = saved;
      queue.clearError();
      setAttempt(saved);
      setDraft({
        code: saved.code,
        notes: saved.notes,
        language: saved.language,
      });
      setError(null);
    } catch (e) {
      setError(e);
    }
  }
  const onReportReady = useCallback(async () => {
    try {
      const saved = await api.get<Attempt>(`/attempts/${initial.id}`);
      queue.current = saved;
      setAttempt(saved);
    } catch {
      /* The Refresh button still reloads it. */
    }
  }, [initial.id, queue]);
  const completed = attempt.status === 'completed';
  const notesField = (
    <Field label="Attempt notes">
      <Textarea
        rows={3}
        className="min-h-20 text-[0.9375rem] md:text-[0.9375rem]"
        placeholder="Approach, mistakes, or a submission link (optional)"
        value={draft.notes}
        readOnly={completed || submitting || !!error}
        onChange={(e) => setDraft((old) => ({ ...old, notes: e.target.value }))}
      />
    </Field>
  );
  const languageField = (
    <Field label="Language">
      <SelectField
        value={draft.language}
        disabled={submitting || !!error}
        onValueChange={(language) => setDraft((old) => ({ ...old, language }))}
      >
        {['python', 'java', 'javascript', 'typescript', 'cpp', 'other'].map((language) => (
          <SelectOption key={language} value={language}>
            {languageLabel(language)}
          </SelectOption>
        ))}
      </SelectField>
    </Field>
  );
  /** The editor fills its panel while drafting; a saved answer keeps a fixed height in the scrolling column. */
  const codeField = (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-2xl ring-1 ring-border',
        !completed &&
          '[@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1',
      )}
      aria-label={completed ? 'Saved code' : 'Solution code'}
    >
      <div
        className={cn(
          'h-[300px] [&_.cm-editor]:text-[14px] [&_.cm-editor]:leading-[1.65] [&_.cm-editor.cm-focused]:outline-2 [&_.cm-editor.cm-focused]:-outline-offset-2 [&_.cm-editor.cm-focused]:outline-ring [&_.cm-scroller]:font-mono!',
          !completed &&
            '[@media(min-width:901px)_and_(min-height:560px)]:h-auto [@media(min-width:901px)_and_(min-height:560px)]:min-h-48 [@media(min-width:901px)_and_(min-height:560px)]:flex-1',
        )}
      >
        <CodeMirror
          className="h-full"
          theme={dark ? 'dark' : 'light'}
          aria-label="Solution code"
          value={draft.code}
          height="100%"
          extensions={extensions}
          editable={!completed && !submitting && !error}
          onChange={(code) => setDraft((old) => ({ ...old, code }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/60 px-3 py-2 text-xs">
        <CopyButton text={draft.code}>Copy code</CopyButton>
      </div>
    </section>
  );
  const draftStatus = (
    <span
      role="status"
      className={cn('text-[0.8125rem]', error ? 'text-destructive' : 'text-muted-foreground')}
    >
      {completed
        ? 'Final answer saved'
        : error
          ? 'Not saved'
          : saving
            ? 'Saving draft…'
            : dirty
              ? 'Unsaved changes'
              : 'Notes and code saved'}
    </span>
  );
  return (
    <div className="mx-auto flex w-full max-w-352 min-w-0 flex-col gap-4 [@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1">
      <div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:no-underline"
          onClick={(e) => {
            if (dirty || saving || submitting) {
              e.preventDefault();
              void saveDraft();
            }
          }}
        >
          <ArrowLeft className="size-4" aria-hidden="true" focusable="false" />
          Back to study desk
        </Link>
      </div>
      <PageHeader
        className="mb-1"
        title={attempt.problem.title}
        description={
          completed
            ? 'Record your result from LeetCode.'
            : 'Record your result from LeetCode. An unfinished solution still counts as practice.'
        }
        actions={
          <Button asChild variant="outline">
            <a href={attempt.problem.url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" focusable="false" />
              Open in LeetCode
            </a>
          </Button>
        }
      />
      {!!error && (
        <div className="[&>.error]:m-0 [&>.error]:rounded-2xl">
          <ErrorNotice
            error={error}
            retry={
              error instanceof ApiError && error.status === 409 ? undefined : () => void retry()
            }
          />
        </div>
      )}
      {error instanceof ApiError && error.status === 409 && (
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl bg-tone-rose-soft py-4 pr-5 pl-6 wrap-anywhere before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-warn">
          <p>
            This attempt changed elsewhere. Copy your current answer before reloading the saved
            version; unsaved local edits will be replaced.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton text={`${draft.code}\n\n${draft.notes}`}>Copy unsaved answer</CopyButton>
            <Button variant="outline" onClick={() => void reloadSaved()}>
              Reload saved version
            </Button>
          </div>
        </div>
      )}
      {completed ? (
        <div className="grid gap-4 min-[901px]:grid-cols-[minmax(0,1fr)_20rem] min-[1100px]:grid-cols-[minmax(0,1fr)_22.5rem] [@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1">
          <ScrollRegion className="flex flex-col gap-4 min-[901px]:col-start-2 min-[901px]:row-start-1">
            <Panel className="gap-4">
              <div className="flex items-center gap-3">
                <IconTile icon={Check} tone="emerald" />
                <h2 className="font-heading text-xl font-bold tracking-[-0.02em]">Attempt saved</h2>
              </div>
              <dl className="flex flex-col divide-y">
                {(
                  [
                    ['Outcome', enumLabel(attempt.outcome)],
                    ['Active time', duration(attempt.activeSeconds)],
                    ['Help', helpLabel(attempt.help)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 font-semibold text-brand-text tabular-nums">
                <CalendarDays className="size-4 shrink-0" aria-hidden="true" focusable="false" />
                <span>
                  Next review:{' '}
                  {attempt.nextReviewDate ? dateLabel(attempt.nextReviewDate) : 'Not scheduled'}
                </span>
              </p>
              <div className="flex flex-col gap-2 border-t pt-4">
                {attempt.scoreDecisions?.length ? (
                  <>
                    <SectionHeader level={3} icon={TrendingUp} title="Topic scores updated" />
                    <List>
                      {attempt.scoreDecisions.map((d) => (
                        <ListRow
                          key={d.id}
                          className="py-2.5"
                          title={d.topicName}
                          to={`/topics/${d.topicId}`}
                          trailing={
                            <>
                              {d.oldScore} →{' '}
                              <strong className="font-semibold text-foreground">
                                {d.newScore}
                              </strong>
                            </>
                          }
                        />
                      ))}
                    </List>
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      Applied automatically from this result. Independent unseen solves can raise a
                      score towards 5; other evidence is capped at 3. Change this in Settings.
                    </p>
                  </>
                ) : (
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    No topic score changed. A score moves only when the evidence supports it — help
                    beyond a small hint, a miss on unseen material, or a score already at its
                    evidence cap leaves it unchanged.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Button asChild variant="default">
                  <Link to="/">Done for now</Link>
                </Button>
                <Button variant="outline" onClick={() => void reloadSaved()}>
                  <RefreshCw aria-hidden="true" focusable="false" />
                  Refresh
                </Button>
              </div>
            </Panel>
          </ScrollRegion>
          <ScrollRegion className="flex flex-col gap-4 min-[901px]:col-start-1 min-[901px]:row-start-1">
            <Panel title="Tutor report" icon={Sparkles} tone="brand" className="gap-3.5">
              <TutorReport attempt={attempt} onReady={onReportReady} />
            </Panel>
            <AttemptReflection
              attempt={attempt}
              onSaved={(saved) => {
                queue.current = saved;
                setAttempt(saved);
              }}
            />
            <AttemptComparison attempt={attempt} />
            <Panel title="Saved code" icon={CodeXml} meta={draftStatus}>
              {codeField}
              {notesField}
            </Panel>
          </ScrollRegion>
        </div>
      ) : null}
      {!completed && (
        <FinishForm
          draft={draft}
          languageField={languageField}
          notesField={notesField}
          codeField={codeField}
          draftStatus={draftStatus}
          busy={submitting}
          locked={!!error}
          onFinish={async (fields) => {
            setSubmitting(true);
            const key = crypto.randomUUID();
            let payload: Record<string, unknown> | undefined;
            const finish = async (a: Attempt) => {
              payload ??= {
                version: a.version,
                ...fields,
                code: draftRef.current.code,
                notes: draftRef.current.notes,
              };
              return api.send<Attempt>(`/attempts/${a.id}/finish`, 'POST', payload, key);
            };
            try {
              await saveDraft();
              if (queue.error) return;
              await run(finish);
              await cache.invalidateQueries({ queryKey: ['dashboard'] });
            } catch {
              /* Retrying reuses the exact payload and key. */
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}
    </div>
  );
}
function FinishForm({
  draft,
  busy,
  locked,
  languageField,
  notesField,
  codeField,
  draftStatus,
  onFinish,
}: {
  draft: Draft;
  busy: boolean;
  locked: boolean;
  languageField: ReactNode;
  notesField: ReactNode;
  codeField: ReactNode;
  draftStatus: ReactNode;
  onFinish: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<Outcome>('solved');
  const [help, setHelp] = useState<Help>('unknown');
  const [seconds, setSeconds] = useState('');
  const [review, setReview] = useState('recommended');
  const [date, setDate] = useState('');
  const [confidence, setConfidence] = useState('');
  const [validationError, setValidationError] = useState('');
  return (
    <form
      className="flex min-w-0 flex-col [@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.code.trim()) {
          setValidationError(
            'Paste your solution code before saving so it can be included in the result summary.',
          );
          return;
        }
        if (!/^[0-9]{1,4}:[0-5][0-9]$/.test(seconds)) {
          setValidationError(
            'Enter your LeetCode solve time as minutes:seconds, for example 9:53.',
          );
          return;
        }
        setValidationError('');
        void onFinish({
          outcome,
          help,
          activeSeconds: seconds.split(':').reduce((total, part) => total * 60 + Number(part), 0),
          reviewAction: review,
          reviewDate: review === 'manual' ? date : null,
          confidence: confidence ? Number(confidence) : null,
          code: draft.code,
          notes: draft.notes,
          requestReview: true,
        });
      }}
    >
      <fieldset
        className="m-0 grid min-w-0 gap-4 border-0 p-0 min-[901px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] [@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1"
        disabled={busy || locked}
      >
        <Panel
          title="Report result"
          icon={Flag}
          tone="brand"
          className="[@media(min-width:901px)_and_(min-height:560px)]:min-h-0"
        >
          <ScrollRegion className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
              <Field label="Outcome">
                <SelectField
                  value={outcome}
                  onValueChange={(value) => setOutcome(value as Outcome)}
                >
                  <SelectOption value="solved">Solved</SelectOption>
                  <SelectOption value="not_solved">Not solved</SelectOption>
                  <SelectOption value="stopped">Stopped</SelectOption>
                </SelectField>
              </Field>
              <Field label="Help used">
                <SelectField value={help} onValueChange={(value) => setHelp(value as Help)}>
                  <SelectOption value="unknown">Unknown</SelectOption>
                  <SelectOption value="none">None</SelectOption>
                  <SelectOption value="small">Small hint</SelectOption>
                  <SelectOption value="major">Major help</SelectOption>
                  <SelectOption value="solution">Solution viewed</SelectOption>
                </SelectField>
              </Field>
              <Field label="LeetCode time">
                <Input
                  required
                  placeholder="mm:ss"
                  pattern="[0-9]{1,4}:[0-5][0-9]"
                  title="Enter minutes and seconds, such as 9:53"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value)}
                />
              </Field>
              <Field label="Confidence">
                <SelectField value={confidence} onValueChange={setConfidence}>
                  <SelectOption value="">Not rated</SelectOption>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <SelectOption key={value} value={String(value)}>
                      {value}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
              <Field label="Next review">
                <SelectField value={review} onValueChange={(value) => setReview(value)}>
                  <SelectOption value="recommended">Use recommended date</SelectOption>
                  <SelectOption value="manual">Choose date</SelectOption>
                  <SelectOption value="none">No scheduled review</SelectOption>
                </SelectField>
              </Field>
              {languageField}
              {review === 'manual' && (
                <Field label="Review date">
                  <DateField required value={date} onValueChange={(value) => setDate(value)} />
                </Field>
              )}
            </div>
            {notesField}
          </ScrollRegion>
          {validationError && (
            <p
              role="alert"
              className="rounded-2xl bg-tone-rose-soft px-4 py-3 text-sm text-destructive"
            >
              {validationError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            {draftStatus}
            <Button type="submit" variant="default" disabled={busy || locked}>
              <Check aria-hidden="true" focusable="false" />
              {busy ? 'Saving attempt…' : 'Save attempt'}
            </Button>
          </div>
        </Panel>
        <Panel
          title="Solution code"
          icon={CodeXml}
          className="[@media(min-width:901px)_and_(min-height:560px)]:min-h-0"
        >
          {codeField}
        </Panel>
      </fieldset>
    </form>
  );
}
