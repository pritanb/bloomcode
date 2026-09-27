import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Attempt } from '../../../shared/contracts';
import { api, ApiError } from '../../app/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorNotice, Field } from '../../components/ui';
import { Panel } from '../../components/kit';
import { Check, NotebookPen } from 'lucide-react';

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
    <Panel title="What will you remember?" icon={NotebookPen}>
      <form
        className="-mt-2 flex flex-col gap-4 [&>.error]:m-0"
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
        <p className="text-[0.8125rem] text-muted-foreground">
          Optional reflections for your mistake notebook.
        </p>
        <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col border-0 p-0">
          <legend className="mb-2.5 text-[0.8125rem] font-medium text-muted-foreground">
            Mistakes to revisit
          </legend>
          <div className="flex flex-wrap gap-2">
            {choices.map(([value, label]) => (
              <label
                className="inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-sm ring-1 ring-border transition-colors ring-inset hover:bg-muted has-data-[state=checked]:bg-brand-soft has-data-[state=checked]:text-brand-text has-data-[state=checked]:ring-brand/40"
                key={value}
              >
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
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={busy || !dirty}>
            {busy ? 'Saving reflection…' : 'Save reflection'}
          </Button>
          {saved && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-up"
            >
              <Check className="size-4" aria-hidden="true" focusable="false" />
              Reflection saved.
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}
