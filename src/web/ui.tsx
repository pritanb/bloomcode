import { enumLabel, helpLabel } from './labels';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell as TablePrimitiveCell } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, type LucideIcon } from 'lucide-react';
import type { Attempt, ScoreDecision } from '../shared/contracts';

/** Icons paired with text never change the control's accessible name. */
export function Icon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph className="icon" aria-hidden="true" focusable="false" />;
}

export function SectionTitle({
  icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <h2 className="section-title">
      <Icon icon={icon} />
      {children}
    </h2>
  );
}

export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div role="alert" className="error">
      <span>
        {error instanceof Error ? error.message : 'Something went wrong.'}
      </span>
      {retry && <Button variant="outline" onClick={retry}>Retry</Button>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      Loading your study records…
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <Label id={id} htmlFor={`${id}-control`}>{label}</Label>
      {Children.map(children, (child) =>
        isValidElement<Record<string, unknown>>(child)
          ? cloneElement(child, { id: `${id}-control`, 'aria-labelledby': id })
          : child,
      )}
    </div>
  );
}

/** Explicit roles preserve table semantics when mobile CSS displays record cards. */
export function ResponsiveTable({
  headers,
  children,
  className = '',
  sorting,
}: {
  sorting?: { active: string; direction: 'asc' | 'desc'; onSort: (header: string) => void; labels: Record<string, string> };
  headers: readonly string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="table-scroll">
      <Table role="table" className={`responsive-table ${className}`}>
        <TableHeader role="rowgroup">
          <TableRow role="row">
            {headers.map((header) => (
              <TableHead key={header} role="columnheader" scope="col" aria-sort={sorting?.active === header ? (sorting.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                {sorting?.labels[header] ? <button type="button" className="table-sort" onClick={() => sorting.onSort(header)} aria-label={`Sort by ${sorting.labels[header]}, ${sorting.active === header && sorting.direction === 'asc' ? 'descending' : 'ascending'}`}>
                  {header}<span aria-hidden="true">{sorting.active === header ? (sorting.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                </button> : header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup">{children}</TableBody>
      </Table>
    </div>
  );
}

export function TableCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TablePrimitiveCell role="cell">
      <span className="cell-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </TablePrimitiveCell>
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

export function MovementList({ items }: { items: ScoreDecision[] }) {
  return items.length ? (
    <ul className="movement-list">
      {items.map((item) => (
        <li key={item.id}>
          <div className="row between">
            <Link to={`/topics/${item.topicId}`}>{item.topicName}</Link>
            <span
              className={
                item.newScore > item.oldScore
                  ? 'positive'
                  : item.newScore < item.oldScore
                    ? 'negative'
                    : 'muted'
              }
            >
              {item.oldScore === item.newScore
                ? 'No change'
                : `${item.oldScore} → ${item.newScore}`}
            </span>
          </div>
          <p>{item.rationale}</p>
          <div className="row small muted">
            <span>{dateLabel(item.date)}</span>
            <span>{enumLabel(item.evidence)}</span>
            {item.attemptId && (
              <Link to={`/attempts/${item.attemptId}`}>View evidence</Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <Empty>
      No score decisions yet. Scores change when attempts or reviews support them.
    </Empty>
  );
}

const attemptHeaders = [
  'Problem',
  'Outcome',
  'Active time',
  'Evidence / help',
  'Tutor note',
] as const;
export function AttemptList({ items, showReview = true }: { items: Attempt[]; showReview?: boolean }) {
  if (!items.length)
    return (
      <Empty>
        No practice recorded yet. Start a question to save your first attempt.
      </Empty>
    );
  return (
    <ResponsiveTable headers={showReview ? attemptHeaders : attemptHeaders.slice(0, 4)}>
      {items.map((a) => (
        <TableRow role="row" key={a.id}>
          <TableCell label={attemptHeaders[0]}>
            <Link to={`/attempts/${a.id}`}>{a.problem.title}</Link>
            <small>{dateLabel(a.finishedAt ?? a.startedAt)}</small>
          </TableCell>
          <TableCell label={attemptHeaders[1]}>
            {enumLabel(a.outcome ?? a.status)}
          </TableCell>
          <TableCell label={attemptHeaders[2]}>
            {duration(a.activeSeconds)}
          </TableCell>
          <TableCell label={attemptHeaders[3]}>
            {enumLabel(a.evidence)}
            <small>{helpLabel(a.help)}</small>
          </TableCell>
          {showReview && <TableCell label={attemptHeaders[4]}>
            {a.status !== 'completed'
              ? 'In progress'
              : a.feedback
                ? 'Tutor note saved'
                : 'No tutor note'}
          </TableCell>}
        </TableRow>
      ))}
    </ResponsiveTable>
  );
}

export function useAction<TVariables, TResult>(
  fn: (variables: TVariables) => Promise<TResult>,
) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await cache.invalidateQueries();
    },
  });
}

export function CopyButton({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const [state, setState] = useState('');
  return (
    <>
      <Button type="button" variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('Copied');
          } catch {
            setState(
              'Clipboard unavailable. Select and copy the text manually.',
            );
          }
        }}
      >
        <Icon icon={Copy} />
        {children}
      </Button>
      {state && (
        <span role="status" className="small">
          {state}
        </span>
      )}
      {state.startsWith('Clipboard') && (
        <Textarea readOnly value={text} aria-label="Text to copy" />
      )}
    </>
  );
}
