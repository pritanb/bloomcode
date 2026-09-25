import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Attempt } from '../../../shared/contracts';
import { api, ApiError } from '../../app/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorNotice, Field } from '../../components/ui';

const choices = [
  ['missed_edge_case', 'Missed edge case'],
  ['wrong_approach', 'Wrong approach'],
  ['implementation_bug', 'Implementation bug'],
] as const;
type Mistake = (typeof choices)[number][0];

export function AttemptReflection({
  attempt,
  onSaved,
}: {
  attempt: Attempt;
  onSaved: (value: Attempt) => void;
}) {
  const cache = useQueryClient();
  const [labels, setLabels] = useState<Mistake[]>(attempt.mistakeLabels ?? []);
  const [takeaway, setTakeaway] = useState(attempt.takeaway ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const dirty =
    JSON.stringify(labels) !== JSON.stringify(attempt.mistakeLabels ?? []) ||
    takeaway !== (attempt.takeaway ?? '');
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const guardLink = (event: MouseEvent) => {
      if (
        (!dirty && !busy) ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target && anchor.target !== '_self') ||
        anchor.hasAttribute('download')
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash
      )
        return;
      if (
        !window.confirm(
          busy
            ? 'Your reflection is still saving. Leave this page?'
            : 'Your reflection has unsaved changes. Leave without saving?',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guardLink, true);
    };
  }, [dirty, busy]);
  return (
    <Card className="panel attempt-reflection">
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            const result = await api.send<Attempt>(`/attempts/${attempt.id}/reflection`, 'PATCH', {
              version: attempt.version,
              mistakeLabels: labels,
              takeaway,
            });
            onSaved(result);
            setSaved(true);
            await cache.invalidateQueries();
          } catch (failure) {
            setError(failure);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="section-title">What will you remember?</h2>
        <p className="small muted">Optional reflections for your mistake notebook.</p>
        <fieldset disabled={busy} className="stack">
          <legend>Mistakes to revisit</legend>
          <div className="reflection-labels">
            {choices.map(([value, label]) => (
              <label className="row" key={value}>
                <Checkbox
                  checked={labels.includes(value)}
                  onCheckedChange={(checked) => {
                    setSaved(false);
                    setLabels((old) =>
                      checked === true ? [...old, value] : old.filter((item) => item !== value),
                    );
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="One-sentence takeaway">
          <Textarea
            rows={2}
            maxLength={2000}
            disabled={busy}
            value={takeaway}
            onChange={(event) => {
              setSaved(false);
              setTakeaway(event.target.value);
            }}
            placeholder="What would you do differently next time?"
          />
        </Field>
        <ErrorNotice error={error} />
        {error instanceof ApiError && error.status === 409 && (
          <div className="stack">
            <p className="small">
              This attempt changed elsewhere. Refresh its version, then save again. Your reflection
              stays in this form.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setBusy(true);
                try {
                  onSaved(await api.get<Attempt>(`/attempts/${attempt.id}`));
                  setError(null);
                } catch (failure) {
                  setError(failure);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              Refresh attempt version
            </Button>
          </div>
        )}
        <div className="row">
          <Button type="submit" variant="outline" disabled={busy || !dirty}>
            {busy ? 'Saving reflection…' : 'Save reflection'}
          </Button>
          {saved && (
            <span role="status" className="positive">
              Reflection saved.
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
