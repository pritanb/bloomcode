import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Children, cloneElement, isValidElement, useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Icons paired with text never change the control's accessible name. */
export function Icon({ icon: Glyph, className }: { icon: LucideIcon; className?: string }) {
  return (
    <Glyph
      className={cn('inline-block size-4 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="error my-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive p-4 wrap-anywhere text-destructive"
    >
      <span>{error instanceof Error ? error.message : 'Something went wrong.'}</span>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Loading() {
  return (
    <div className="px-12 py-12 text-center text-muted-foreground" role="status">
      Loading your study records…
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 leading-normal [&_[data-slot=select-trigger]]:w-full">
      <Label id={id} htmlFor={`${id}-control`}>
        {label}
      </Label>
      {Children.map(children, (child) =>
        isValidElement<Record<string, unknown>>(child)
          ? cloneElement(child, { id: `${id}-control`, 'aria-labelledby': id })
          : child,
      )}
    </div>
  );
}

export function duration(seconds: number | null) {
  if (seconds === null) return 'Unknown';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function dateLabel(value: string | null) {
  if (!value) return 'Not recorded';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return new Date(value + 'T12:00:00').toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return new Date(value).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function useAction<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await cache.invalidateQueries();
    },
  });
}

export function CopyButton({ text, children }: { text: string; children: ReactNode }) {
  const [state, setState] = useState('');
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('Copied');
          } catch {
            setState('Clipboard unavailable. Select and copy the text manually.');
          }
        }}
      >
        <Icon icon={Copy} />
        {children}
      </Button>
      {state && (
        <span role="status" className="text-xs text-muted-foreground">
          {state}
        </span>
      )}
      {state.startsWith('Clipboard') && (
        <Textarea readOnly value={text} aria-label="Text to copy" />
      )}
    </>
  );
}
