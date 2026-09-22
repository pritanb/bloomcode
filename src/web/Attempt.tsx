import { enumLabel, helpLabel, languageLabel } from './labels';
import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { useDarkMode } from './theme';
import { Card } from '@/components/ui/card';
import { SelectField, SelectOption } from '@/components/select-field';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flag,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import type { Attempt, Help, Outcome } from '../shared/contracts';
import { api, ApiError } from './api';
import { AttemptQueue } from './attemptQueue';
import { AttemptComparison } from './AttemptComparison';
import { AttemptReflection } from './AttemptReflection';
import { TutorReport } from './TutorReport';
import {
  Icon,
  SectionTitle,
  CopyButton,
  dateLabel,
  duration,
  ErrorNotice,
  Field,
  Loading,
  PageTitle,
} from './ui';
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
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
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
    if (
      attempt.status === 'completed' ||
      submitting ||
      error ||
      sameDraft(attempt, draft)
    )
      return;
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
    ...(draft.language === 'python'
      ? [python()]
      : draft.language === 'java'
        ? [java()]
        : []),
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
  const notesField = <>
    <Field label="Attempt notes">
      <Textarea rows={3} placeholder="Approach, mistakes, or a submission link (optional)" value={draft.notes} readOnly={completed || submitting || !!error} onChange={e => setDraft(old => ({...old, notes: e.target.value}))} />
    </Field>
  </>;
  const languageField = <Field label="Language"><SelectField value={draft.language} disabled={submitting || !!error} onValueChange={language => setDraft(old => ({...old, language}))}>
        {['python','java','javascript','typescript','cpp','other'].map(language => <SelectOption key={language} value={language}>{languageLabel(language)}</SelectOption>)}
      </SelectField></Field>;
  const codeField = <section className="stack report-code" aria-label={completed ? 'Saved code' : 'Solution code'}>
      <h3 className="report-column-title">{completed ? 'Saved code' : 'Solution code'}</h3>
      <Card className="code-panel">
        <CodeMirror theme={dark ? 'dark' : 'light'} aria-label="Solution code" value={draft.code} height="300px" extensions={extensions} editable={!completed && !submitting && !error} onChange={code => setDraft(old => ({...old, code}))} />
        <div className="code-footer"><CopyButton text={draft.code}>Copy code</CopyButton></div>
      </Card>
    </section>;
  const draftStatus = <span role="status" className={error ? 'negative' : 'muted small'}>{completed ? 'Final answer saved' : error ? 'Not saved' : saving ? 'Saving draft…' : dirty ? 'Unsaved changes' : 'Notes and code saved'}</span>;
  return (
    <>
      <div className="workspace-top">
        <Link
          to="/"
          onClick={(e) => {
            if (dirty || saving || submitting) {
              e.preventDefault();
              void saveDraft();
            }
          }}
        >
          <Icon icon={ArrowLeft} />
          Back to study desk
        </Link>
      </div>
      <PageTitle title={attempt.problem.title} description="Record your result from LeetCode.">
        <Button asChild variant="outline"><a
          href={attempt.problem.url}
          target="_blank"
          rel="noreferrer"
        >
          <Icon icon={ExternalLink} />
          Open in LeetCode
        </a></Button>
      </PageTitle>
      <ErrorNotice
        error={error}
        retry={
          error instanceof ApiError && error.status === 409
            ? undefined
            : () => void retry()
        }
      />
      {error instanceof ApiError && error.status === 409 && (
        <div className="warning">
          <p>
            This attempt changed elsewhere. Copy your current answer before
            reloading the saved version; unsaved local edits will be replaced.
          </p>
          <div className="row">
            <CopyButton text={`${draft.code}\n\n${draft.notes}`}>
              Copy unsaved answer
            </CopyButton>
            <Button variant="outline" onClick={() => void reloadSaved()}>
              Reload saved version
            </Button>
          </div>
        </div>
      )}
      {completed ? (
        <Card className="completion panel">
          <div className="row between">
            <div>
              <h2>Attempt saved</h2>
              <p>
                {enumLabel(attempt.outcome)} ·{' '}
                {duration(attempt.activeSeconds)} active time ·{' '}
                {helpLabel(attempt.help)}
              </p>
            </div>
            <span className="completion-mark" aria-hidden="true">
              <Icon icon={Check} />
            </span>
          </div>
          {attempt.scoreDecisions?.length ? (
            <div className="stack">
              <h3>Topic scores updated</h3>
              <ul className="plain-list score-movements">
                {attempt.scoreDecisions.map(d => (
                  <li key={d.id} className="row between">
                    <Link to={`/topics/${d.topicId}`}>{d.topicName}</Link>
                    <span className="small">
                      {d.oldScore} → <strong>{d.newScore}</strong>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="small muted">
                Applied automatically from this result. Independent unseen
                solves can raise a score towards 5; other evidence is capped at
                3. Change this in Settings.
              </p>
            </div>
          ) : (
            <p className="small muted">
              No topic score changed. A score moves only when the evidence
              supports it — help beyond a small hint, a miss on unseen
              material, or a score already at its evidence cap leaves it
              unchanged.
            </p>
          )}
          <div className="stack">
            <h3>Tutor report</h3>
            <TutorReport attempt={attempt} onReady={onReportReady} />
          </div>
          <p>
            Next review:{' '}
            {attempt.nextReviewDate
              ? dateLabel(attempt.nextReviewDate)
              : 'Not scheduled'}
          </p>
          <div className="row">
            <Button asChild variant="default"><Link  to="/">
              Done for now
            </Link></Button>
            <Button variant="outline" onClick={() => void reloadSaved()}>
              <Icon icon={RefreshCw} />
              Refresh
            </Button>
          </div>
        </Card>
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
              return api.send<Attempt>(
                `/attempts/${a.id}/finish`,
                'POST',
                payload,
                key,
              );
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
      {completed && <><AttemptReflection attempt={attempt} onSaved={saved => { queue.current = saved; setAttempt(saved); }} /><AttemptComparison attempt={attempt} /><div className="stack">{notesField}{codeField}{draftStatus}</div></>}
    </>
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
  languageField: React.ReactNode;
  notesField: React.ReactNode;
  codeField: React.ReactNode;
  draftStatus: React.ReactNode;
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
    <Card className="panel finish-panel">
      <SectionTitle icon={Flag}>Report result</SectionTitle>
      <p className="muted">
        Record what happened. An unfinished solution still counts as practice.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.code.trim()) {
            setValidationError('Paste your solution code before saving so it can be included in the result summary.');
            return;
          }
          if (!/^[0-9]{1,4}:[0-5][0-9]$/.test(seconds)) {
            setValidationError('Enter your LeetCode solve time as minutes:seconds, for example 9:53.');
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
        <fieldset className="report-columns" disabled={busy || locked}>
          <div className="stack report-fields">
          <h3 className="report-column-title">Result details</h3>
          <div className="form-grid">
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
              <SelectField
                value={help}
                onValueChange={(value) => setHelp(value as Help)}
              >
                <SelectOption value="unknown">Unknown</SelectOption>
                <SelectOption value="none">None</SelectOption>
                <SelectOption value="small">Small hint</SelectOption>
                <SelectOption value="major">Major help</SelectOption>
                <SelectOption value="solution">Solution viewed</SelectOption>
              </SelectField>
            </Field>
            <Field label="LeetCode time">
              <Input required placeholder="mm:ss" pattern="[0-9]{1,4}:[0-5][0-9]" title="Enter minutes and seconds, such as 9:53" value={seconds} onChange={e => setSeconds(e.target.value)} />
            </Field>
            <Field label="Confidence">
              <SelectField value={confidence} onValueChange={setConfidence}>
                <SelectOption value="">Not rated</SelectOption>
                {[1,2,3,4,5].map(value => <SelectOption key={value} value={String(value)}>{value}</SelectOption>)}
              </SelectField>
            </Field>
            <Field label="Next review">
              <SelectField
                value={review}
                onValueChange={(value) => setReview(value)}
              >
                <SelectOption value="recommended">Use recommended date</SelectOption>
                <SelectOption value="manual">Choose date</SelectOption>
                <SelectOption value="none">No scheduled review</SelectOption>
              </SelectField>
            </Field>
            {languageField}
            {review === 'manual' && (
              <Field label="Review date">
                <DateField
                  required
                  value={date}
                  onValueChange={(value) => setDate(value)}
                />
              </Field>
            )}
          </div>
          {notesField}
          </div>
          {codeField}
        </fieldset>
        {validationError && <p role="alert" className="negative">{validationError}</p>}
        <div className="report-footer">
          {draftStatus}
          <Button variant="default" disabled={busy || locked}>
            {busy ? 'Saving attempt…' : 'Save attempt'}
          </Button>

        </div>
      </form>
    </Card>
  );
}
