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
      {retry && <button onClick={retry}>Retry</button>}
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
    <label className="field">
      <span id={id}>{label}</span>
      {Children.map(children, (child) =>
        isValidElement<Record<string, unknown>>(child) &&
        ['input', 'select', 'textarea'].includes(String(child.type))
          ? cloneElement(child, { 'aria-labelledby': id })
          : child,
      )}
    </label>
  );
}

/** Explicit roles preserve table semantics when mobile CSS displays record cards. */
export function ResponsiveTable({
  headers,
  children,
  className = '',
}: {
  headers: readonly string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="table-scroll">
      <table role="table" className={`responsive-table ${className}`}>
        <thead role="rowgroup">
          <tr role="row">
            {headers.map((header) => (
              <th key={header} role="columnheader" scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
      </table>
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
    <td role="cell">
      <span className="cell-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </td>
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
            <span>{item.evidence.replaceAll('_', ' ')}</span>
            {item.attemptId && (
              <Link to={`/attempts/${item.attemptId}`}>View evidence</Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <Empty>
      No score decisions yet. Scores change only when supported by a review.
    </Empty>
  );
}

const attemptHeaders = [
  'Problem',
  'Outcome',
  'Active time',
  'Evidence / help',
  'Review',
] as const;
export function AttemptList({ items }: { items: Attempt[] }) {
  if (!items.length)
    return (
      <Empty>
        No practice recorded yet. Start a question to save your first attempt.
      </Empty>
    );
  return (
    <ResponsiveTable headers={attemptHeaders}>
      {items.map((a) => (
        <tr role="row" key={a.id}>
          <TableCell label={attemptHeaders[0]}>
            <Link to={`/attempts/${a.id}`}>{a.problem.title}</Link>
            <small>{dateLabel(a.finishedAt ?? a.startedAt)}</small>
          </TableCell>
          <TableCell label={attemptHeaders[1]}>
            {a.outcome?.replaceAll('_', ' ') ?? a.status}
          </TableCell>
          <TableCell label={attemptHeaders[2]}>
            {duration(a.activeSeconds)}
          </TableCell>
          <TableCell label={attemptHeaders[3]}>
            {a.evidence?.replaceAll('_', ' ')}
            <small>{a.help === 'none' ? 'No help' : `${a.help} help`}</small>
          </TableCell>
          <TableCell label={attemptHeaders[4]}>
            {a.reviewedAt
              ? 'Reviewed'
              : a.status === 'completed'
                ? 'Awaiting tutor review'
                : 'In progress'}
          </TableCell>
        </tr>
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
      <button
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
      </button>
      {state && (
        <span role="status" className="small">
          {state}
        </span>
      )}
      {state.startsWith('Clipboard') && (
        <textarea readOnly value={text} aria-label="Text to copy" />
      )}
    </>
  );
}
