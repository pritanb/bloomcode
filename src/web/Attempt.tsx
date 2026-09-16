import {
  ArrowLeft,
  Check,
  CodeXml,
  ExternalLink,
  Flag,
  Pause,
  Play,
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
function activeTime(a: Attempt, now: number) {
  return a.activeSeconds === null
    ? null
    : a.activeSeconds +
        (a.status === 'active' && a.lastHeartbeatAt && !a.needsGapDecision
          ? Math.min(
              120,
              Math.max(
                0,
                Math.floor((now - Date.parse(a.lastHeartbeatAt)) / 1000),
              ),
            )
          : 0);
}
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
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const update = () => setDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
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
  const [now, setNow] = useState(Date.now());
  const [closing, setClosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [timerBusy, setTimerBusy] = useState(false);
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
  const timer = useCallback(
    async (action: 'pause' | 'resume' | 'heartbeat', includeGap?: boolean) => {
      setTimerBusy(true);
      try {
        await run((a) =>
          a.status === 'completed'
            ? Promise.resolve(a)
            : api.send<Attempt>(`/attempts/${a.id}/timer`, 'POST', {
                version: a.version,
                action,
                ...(includeGap !== undefined ? { includeGap } : {}),
              }),
        );
      } catch {
        /* Keep error visible. */
      } finally {
        setTimerBusy(false);
      }
    },
    [run],
  );
  useEffect(() => {
    if (
      attempt.status === 'completed' ||
      closing ||
      error ||
      sameDraft(attempt, draft)
    )
      return;
    const id = window.setTimeout(() => void saveDraft(), 650);
    return () => window.clearTimeout(id);
  }, [draft, attempt, closing, error, saveDraft]);
  useEffect(() => {
    if (initial.status === 'completed') return;
    void timer('heartbeat');
    const id = window.setInterval(() => {
      if (!queue.error && queue.current.status === 'active')
        void timer('heartbeat');
    }, 20000);
    return () => window.clearInterval(id);
  }, [initial.status, queue, timer]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
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
  async function openFinish() {
    await saveDraft();
    if (queue.error) return;
    await timer('pause');
    if (!queue.error && !queue.current.needsGapDecision) setClosing(true);
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
      setClosing(false);
    } catch (e) {
      setError(e);
    }
  }
  const completed = attempt.status === 'completed';
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
        <span className="small muted">
          Focused workspace · patterns and history hidden
        </span>
      </div>
      <PageTitle title={attempt.problem.title}>
        <a
          className="button"
          href={attempt.problem.url}
          target="_blank"
          rel="noreferrer"
        >
          <Icon icon={ExternalLink} />
          Open in LeetCode
        </a>
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
            <button onClick={() => void reloadSaved()}>
              Reload saved version
            </button>
          </div>
        </div>
      )}
      {completed ? (
        <section className="completion panel">
          <div className="row between">
            <div>
              <h2>
                {attempt.reviewedAt
                  ? 'Tutor review saved'
                  : 'Awaiting tutor review'}
              </h2>
              <p>
                {attempt.outcome?.replaceAll('_', ' ')} ·{' '}
                {duration(attempt.activeSeconds)} active time ·{' '}
                {attempt.help === 'none' ? 'No help' : `${attempt.help} help`}
              </p>
            </div>
            <span className="completion-mark" aria-hidden="true">
              <Icon icon={Check} />
            </span>
          </div>
          <p className="small muted">
            {attempt.reviewedAt
              ? `Reviewed ${dateLabel(attempt.reviewedAt)}`
              : 'Your attempt is saved. Topic scores stay unchanged until an evidence-based review.'}
          </p>
          {attempt.feedback && (
            <div className="feedback preserve">{attempt.feedback}</div>
          )}
          <p>
            Next review:{' '}
            {attempt.nextReviewDate
              ? dateLabel(attempt.nextReviewDate)
              : 'Not scheduled'}
          </p>
          <div className="row">
            <CopyButton
              text={`Please review my saved LeetCode Tutor attempt ${attempt.id}. Use the app tools to retrieve it and record an evidence-based review.`}
            >
              Copy Hermes review prompt
            </CopyButton>
            <button onClick={() => void reloadSaved()}>
              <Icon icon={RefreshCw} />
              Refresh feedback
            </button>
            <Link className="button primary" to="/">
              Done for now
            </Link>
          </div>
          <p className="small muted">
            Copying does not start Hermes. Send the prompt in your own chat; the
            configured model may receive this attempt’s code and context.
          </p>
        </section>
      ) : (
        <section className="workspace-toolbar">
          <Field label="Language">
            <select
              disabled={closing || submitting}
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            >
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="cpp">C++</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <div className="timer">
            <span>Active time</span>
            <strong aria-label="Elapsed active time">
              {duration(activeTime(attempt, now))}
            </strong>
            <span className="badge">{attempt.status}</span>
          </div>
          <div className="row">
            <button
              disabled={
                timerBusy || closing || !!error || attempt.needsGapDecision
              }
              onClick={() =>
                void timer(attempt.status === 'active' ? 'pause' : 'resume')
              }
            >
              <Icon icon={attempt.status === 'active' ? Pause : Play} />
              {attempt.status === 'active' ? 'Pause' : 'Resume timer'}
            </button>
            <button
              className="primary"
              disabled={
                closing || submitting || !!error || attempt.needsGapDecision
              }
              onClick={() => void openFinish()}
            >
              <Icon icon={Flag} />
              Finish attempt
            </button>
          </div>
        </section>
      )}
      {attempt.needsGapDecision && !completed && (
        <div className="warning">
          <h2>Were you practising while disconnected?</h2>
          <p>
            The timer paused at its last check-in. Choose whether to count the
            gap before resuming or finishing.
          </p>
          <div className="row">
            <button
              disabled={timerBusy}
              onClick={() => void timer('resume', false)}
            >
              Exclude the gap
            </button>
            <button
              disabled={timerBusy}
              onClick={() => void timer('resume', true)}
            >
              Include the gap
            </button>
          </div>
        </div>
      )}
      <section className="code-panel">
        <div className="code-heading">
          <SectionTitle icon={CodeXml}>
            {completed ? 'Saved answer' : 'Your answer'}
          </SectionTitle>
          <span className="small muted">
            Draft here. Run and submit on LeetCode.
          </span>
        </div>
        <CodeMirror
          theme={dark ? 'dark' : 'light'}
          aria-label="Code editor"
          value={draft.code}
          height="390px"
          extensions={extensions}
          editable={!completed && !closing && !submitting}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
          }}
          onChange={(code) => setDraft((old) => ({ ...old, code }))}
        />
        <div className="code-footer">
          <CopyButton text={draft.code}>Copy code</CopyButton>
          <span role="status" className={error ? 'negative' : 'muted'}>
            {completed
              ? 'Final answer saved'
              : error
                ? 'Not saved'
                : saving
                  ? 'Saving draft…'
                  : dirty
                    ? 'Unsaved changes'
                    : 'Draft saved'}
          </span>
        </div>
      </section>
      <section className="panel notes-panel">
        <Field label="Attempt notes">
          <textarea
            rows={4}
            placeholder="Approach, edge cases, or a submission link (optional)"
            value={draft.notes}
            readOnly={completed || closing || submitting}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>
      </section>
      {closing && !completed && (
        <FinishForm
          attempt={attempt}
          draft={draft}
          busy={submitting}
          locked={!!error}
          onCancel={() => setClosing(false)}
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
              await run(finish);
              setClosing(false);
              await cache.invalidateQueries({ queryKey: ['dashboard'] });
            } catch {
              /* Retrying reuses the exact payload and key. */
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}
    </>
  );
}
function FinishForm({
  attempt,
  draft,
  busy,
  locked,
  onCancel,
  onFinish,
}: {
  attempt: Attempt;
  draft: Draft;
  busy: boolean;
  locked: boolean;
  onCancel: () => void;
  onFinish: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<Outcome>('solved');
  const [help, setHelp] = useState<Help>('unknown');
  const [seconds, setSeconds] = useState(String(attempt.activeSeconds ?? ''));
  const [unknown, setUnknown] = useState(attempt.activeSeconds === null);
  const [review, setReview] = useState('recommended');
  const [date, setDate] = useState('');
  const [confidence, setConfidence] = useState('');
  return (
    <section className="panel finish-panel">
      <SectionTitle icon={Flag}>Finish attempt</SectionTitle>
      <p className="muted">
        Record what happened. An unfinished solution still counts as practice.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void onFinish({
            outcome,
            help,
            activeSeconds: unknown ? null : Number(seconds),
            reviewAction: review,
            reviewDate: review === 'manual' ? date : null,
            confidence: confidence ? Number(confidence) : null,
            code: draft.code,
            notes: draft.notes,
          });
        }}
      >
        <fieldset disabled={busy || locked}>
          <div className="form-grid">
            <Field label="Outcome">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as Outcome)}
              >
                <option value="solved">Solved (self-reported)</option>
                <option value="not_solved">Not solved</option>
                <option value="stopped">Stopped</option>
              </select>
            </Field>
            <Field label="Help used">
              <select
                value={help}
                onChange={(e) => setHelp(e.target.value as Help)}
              >
                <option value="unknown">Unknown</option>
                <option value="none">None</option>
                <option value="small">Small hint</option>
                <option value="major">Major help</option>
                <option value="solution">Solution viewed</option>
              </select>
            </Field>
            <Field label="Active time (seconds)">
              <input
                required={!unknown}
                disabled={unknown}
                type="number"
                min="0"
                step="1"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            </Field>
            <label className="check">
              <input
                type="checkbox"
                checked={unknown}
                onChange={(e) => setUnknown(e.target.checked)}
              />
              Time unknown
            </label>
            <Field label="Next review">
              <select
                value={review}
                onChange={(e) => setReview(e.target.value)}
              >
                <option value="recommended">Use recommended date</option>
                <option value="manual">Choose date</option>
                <option value="none">No scheduled review</option>
              </select>
            </Field>
            {review === 'manual' && (
              <Field label="Review date">
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
            )}
          </div>
          <details>
            <summary>Optional details</summary>
            <Field label="Confidence (1–5)">
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
              />
            </Field>
          </details>
        </fieldset>
        <div className="row">
          <button className="primary" disabled={busy || locked}>
            {busy ? 'Saving attempt…' : 'Save attempt'}
          </button>
          <button type="button" disabled={busy || locked} onClick={onCancel}>
            Back to draft
          </button>
        </div>
      </form>
    </section>
  );
}
