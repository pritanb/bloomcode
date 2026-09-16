import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
            <Button variant="outline" onClick={() => void reloadSaved()}>
              <Icon icon={RefreshCw} />
              Refresh feedback
            </Button>
            <Button asChild variant="default"><Link  to="/">
              Done for now
            </Link></Button>
          </div>
          <p className="small muted">
            Copying does not start Hermes. Send the prompt in your own chat; the
            configured model may receive this attempt’s code and context.
          </p>
        </Card>
      ) : (
        <Card className="workspace-toolbar">
          <Field label="Language">
            <NativeSelect
              disabled={closing || submitting}
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
            >
              <NativeSelectOption value="python">Python</NativeSelectOption>
              <NativeSelectOption value="java">Java</NativeSelectOption>
              <NativeSelectOption value="javascript">JavaScript</NativeSelectOption>
              <NativeSelectOption value="typescript">TypeScript</NativeSelectOption>
              <NativeSelectOption value="cpp">C++</NativeSelectOption>
              <NativeSelectOption value="other">Other</NativeSelectOption>
            </NativeSelect>
          </Field>
          <div className="timer">
            <span>Active time</span>
            <strong aria-label="Elapsed active time">
              {duration(activeTime(attempt, now))}
            </strong>
            <Badge variant="secondary" className="badge">{attempt.status}</Badge>
          </div>
          <div className="row">
            <Button variant="outline"
              disabled={
                timerBusy || closing || !!error || attempt.needsGapDecision
              }
              onClick={() =>
                void timer(attempt.status === 'active' ? 'pause' : 'resume')
              }
            >
              <Icon icon={attempt.status === 'active' ? Pause : Play} />
              {attempt.status === 'active' ? 'Pause' : 'Resume timer'}
            </Button>
            <Button
              variant="default"
              disabled={
                closing || submitting || !!error || attempt.needsGapDecision
              }
              onClick={() => void openFinish()}
            >
              <Icon icon={Flag} />
              Finish attempt
            </Button>
          </div>
        </Card>
      )}
      {attempt.needsGapDecision && !completed && (
        <div className="warning">
          <h2>Were you practising while disconnected?</h2>
          <p>
            The timer paused at its last check-in. Choose whether to count the
            gap before resuming or finishing.
          </p>
          <div className="row">
            <Button variant="outline"
              disabled={timerBusy}
              onClick={() => void timer('resume', false)}
            >
              Exclude the gap
            </Button>
            <Button variant="outline"
              disabled={timerBusy}
              onClick={() => void timer('resume', true)}
            >
              Include the gap
            </Button>
          </div>
        </div>
      )}
      <Card className="code-panel">
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
      </Card>
      <Card className="panel notes-panel">
        <Field label="Attempt notes">
          <Textarea
            rows={4}
            placeholder="Approach, edge cases, or a submission link (optional)"
            value={draft.notes}
            readOnly={completed || closing || submitting}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>
      </Card>
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
    <Card className="panel finish-panel">
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
              <NativeSelect
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as Outcome)}
              >
                <NativeSelectOption value="solved">Solved (self-reported)</NativeSelectOption>
                <NativeSelectOption value="not_solved">Not solved</NativeSelectOption>
                <NativeSelectOption value="stopped">Stopped</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label="Help used">
              <NativeSelect
                value={help}
                onChange={(e) => setHelp(e.target.value as Help)}
              >
                <NativeSelectOption value="unknown">Unknown</NativeSelectOption>
                <NativeSelectOption value="none">None</NativeSelectOption>
                <NativeSelectOption value="small">Small hint</NativeSelectOption>
                <NativeSelectOption value="major">Major help</NativeSelectOption>
                <NativeSelectOption value="solution">Solution viewed</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field label="Active time (seconds)">
              <Input
                required={!unknown}
                disabled={unknown}
                type="number"
                min="0"
                step="1"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            </Field>
            <Label className="check">
              <Checkbox
                checked={unknown}
                onCheckedChange={(checked) => setUnknown(checked === true)}
              />
              Time unknown
            </Label>
            <Field label="Next review">
              <NativeSelect
                value={review}
                onChange={(e) => setReview(e.target.value)}
              >
                <NativeSelectOption value="recommended">Use recommended date</NativeSelectOption>
                <NativeSelectOption value="manual">Choose date</NativeSelectOption>
                <NativeSelectOption value="none">No scheduled review</NativeSelectOption>
              </NativeSelect>
            </Field>
            {review === 'manual' && (
              <Field label="Review date">
                <Input
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
              <Input
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
          <Button variant="default" disabled={busy || locked}>
            {busy ? 'Saving attempt…' : 'Save attempt'}
          </Button>
          <Button variant="outline" type="button" disabled={busy || locked} onClick={onCancel}>
            Back to draft
          </Button>
        </div>
      </form>
    </Card>
  );
}
