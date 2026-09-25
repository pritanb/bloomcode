import { enumLabel, helpLabel } from '../../lib/labels';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import type { Attempt } from '../../../shared/contracts';
import { dateLabel, duration, Empty } from '../../components/ui';
import { outcomeTone } from './library-utils';

export function AttemptHistory({ items }: { items: Attempt[] }) {
  const ordered = [...items].sort(
    (a, b) =>
      (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt) ||
      b.id.localeCompare(a.id),
  );
  if (!ordered.length)
    return <Empty>No practice recorded yet. Start a question to save your first attempt.</Empty>;
  return (
    <ol className="movement-list attempt-history">
      {ordered.map((a, index) => (
        <li key={a.id}>
          <div className="attempt-history-body">
            <div className="row between">
              <h3>
                Attempt {ordered.length - index}
                <span className="small muted"> · {dateLabel(a.finishedAt ?? a.startedAt)}</span>
              </h3>
              <Link className="small" to={`/attempts/${a.id}`}>
                Open saved attempt
              </Link>
            </div>
            <div className="chips">
              <Badge variant="secondary" className={`outcome-badge ${outcomeTone(a.outcome)}`}>
                {enumLabel(a.outcome ?? a.status)}
              </Badge>
              <Badge variant="secondary">{duration(a.activeSeconds)}</Badge>
              <Badge variant="secondary">{helpLabel(a.help)}</Badge>
              <Badge variant="secondary">{enumLabel(a.evidence)}</Badge>
              {a.confidence !== null && (
                <Badge variant="secondary">Confidence {a.confidence}/5</Badge>
              )}
              {(a.mistakeLabels ?? []).map((label) => (
                <Badge variant="secondary" key={label}>
                  {enumLabel(label)}
                </Badge>
              ))}
            </div>
            <div className="attempt-history-columns">
              <section className="attempt-history-notes" aria-label="Attempt notes">
                <h4>Attempt notes</h4>
                {a.notes ? (
                  <p className="preserve">{a.notes}</p>
                ) : (
                  <p className="muted">No notes recorded.</p>
                )}
                {a.takeaway && (
                  <div className="attempt-history-takeaway">
                    <h4>Takeaway</h4>
                    <p className="preserve">{a.takeaway}</p>
                  </div>
                )}
              </section>
              <section className="attempt-history-feedback" aria-label="Tutor note">
                <h4>Tutor note</h4>
                {a.feedback ? (
                  <p className="preserve">{a.feedback}</p>
                ) : (
                  <p className="muted">
                    {a.status === 'completed'
                      ? 'No tutor note for this attempt.'
                      : 'Attempt in progress.'}
                  </p>
                )}
              </section>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
