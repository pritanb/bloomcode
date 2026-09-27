import { enumLabel, helpLabel } from '../../lib/labels';
import { Check, CircleDashed, History, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Attempt } from '../../../shared/contracts';
import { dateLabel, duration } from '../../components/ui';
import { EmptyState, IconTile, ToneBadge } from '../../components/kit';

const outcomeLook = (outcome: string | null) =>
  outcome === 'solved'
    ? ({ icon: Check, tone: 'emerald' } as const)
    : outcome === 'not_solved'
      ? ({ icon: X, tone: 'rose' } as const)
      : ({ icon: CircleDashed, tone: 'neutral' } as const);

const noteLabel = 'mb-1.5 text-[0.8125rem] font-medium text-muted-foreground';

export function AttemptHistory({ items }: { items: Attempt[] }) {
  const ordered = [...items].sort(
    (a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) ||
      b.id.localeCompare(a.id),
  );
  if (!ordered.length)
    return (
      <EmptyState
        className="flex-1"
        icon={History}
        title="No practice recorded yet"
        description="Start a question to save your first attempt."
      />
    );
  return (
    <ol className="m-0 flex list-none flex-col divide-y p-0">
      {ordered.map((a, index) => {
        const look = outcomeLook(a.outcome);
        return (
          <li key={a.id} className="flex gap-3.5 py-5 first:pt-1 last:pb-0">
            <IconTile icon={look.icon} tone={look.tone} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 @container">
              <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 className="font-heading text-base font-semibold tracking-[-0.01em]">
                  Attempt {ordered.length - index}
                  <span className="font-sans text-[0.8125rem] font-normal tracking-normal text-muted-foreground">
                    {' '}
                    · {dateLabel(a.finishedAt ?? a.startedAt)}
                  </span>
                </h3>
                <Link className="text-[0.8125rem] font-medium" to={`/attempts/${a.id}`}>
                  Open saved attempt
                </Link>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ToneBadge tone={look.tone}>{enumLabel(a.outcome ?? a.status)}</ToneBadge>
                <ToneBadge className="tabular-nums">{duration(a.activeSeconds)}</ToneBadge>
                <ToneBadge>{helpLabel(a.help)}</ToneBadge>
                <ToneBadge>{enumLabel(a.evidence)}</ToneBadge>
                {a.confidence !== null && <ToneBadge>Confidence {a.confidence}/5</ToneBadge>}
                {(a.mistakeLabels ?? []).map((label) => (
                  <ToneBadge key={label}>{enumLabel(label)}</ToneBadge>
                ))}
              </div>
              <div className="mt-1.5 grid gap-5 rounded-2xl bg-muted px-[1.125rem] py-4 text-[0.9375rem] leading-relaxed @[40rem]:grid-cols-2 @[40rem]:gap-8">
                <section className="min-w-0" aria-label="Attempt notes">
                  <h4 className={noteLabel}>Attempt notes</h4>
                  {a.notes ? (
                    <p className="whitespace-pre-wrap wrap-anywhere">{a.notes}</p>
                  ) : (
                    <p className="text-muted-foreground">No notes recorded.</p>
                  )}
                  {a.takeaway && (
                    <div className="mt-5">
                      <h4 className={noteLabel}>Takeaway</h4>
                      <p className="whitespace-pre-wrap wrap-anywhere">{a.takeaway}</p>
                    </div>
                  )}
                </section>
                <section
                  className="min-w-0 border-t pt-5 @[40rem]:border-t-0 @[40rem]:border-l @[40rem]:pt-0 @[40rem]:pl-8"
                  aria-label="Tutor note"
                >
                  <h4 className={noteLabel}>Tutor note</h4>
                  {a.feedback ? (
                    <p className="whitespace-pre-wrap wrap-anywhere">{a.feedback}</p>
                  ) : (
                    <p className="text-muted-foreground">
                      {a.status === 'completed'
                        ? 'No tutor note for this attempt.'
                        : 'Attempt in progress.'}
                    </p>
                  )}
                </section>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
