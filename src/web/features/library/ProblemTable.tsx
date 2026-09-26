import { Dialog } from 'radix-ui';
import { tagColour } from '../../lib/tag-colour';
import { enumLabel, helpLabel, languageLabel } from '../../lib/labels';
import { Button } from '@/components/ui/button';
import { TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import type { Problem } from '../../../shared/contracts';
import { dateLabel, duration, ResponsiveTable, TableCell } from '../../components/ui';
import { outcomeTone } from './library-utils';

const problemHeaders = [
  'Question',
  'Tags',
  'Difficulty',
  'Latest submission',
  'LeetCode time',
  'Confidence',
  'Next review',
  'Attempt notes',
] as const;
const problemSortKeys: Record<string, string> = {
  Question: 'title',
  Difficulty: 'difficulty',
  'Latest submission': 'lastAttempt',
  'LeetCode time': 'solveTime',
  Confidence: 'confidence',
  'Next review': 'reviewDate',
};
export function ProblemTable({
  problems,
  sort = 'title',
  direction = 'asc',
  onSort,
}: {
  problems: Problem[];
  sort?: string;
  direction?: 'asc' | 'desc';
  onSort?: (key: string) => void;
}) {
  return (
    <ResponsiveTable
      headers={problemHeaders}
      className={`problem-table${onSort ? ' sortable-table' : ''}`}
      sorting={
        onSort
          ? {
              active:
                Object.keys(problemSortKeys).find((header) => problemSortKeys[header] === sort) ??
                '',
              direction,
              onSort: (header) => onSort(problemSortKeys[header]),
              labels: {
                Question: 'question title',
                Difficulty: 'difficulty',
                'Latest submission': 'last attempt',
                'LeetCode time': 'solve time',
                Confidence: 'confidence',
                'Next review': 'next review',
              },
            }
          : undefined
      }
    >
      {problems.map((p) => (
        <TableRow role="row" key={p.id}>
          <TableCell label={problemHeaders[0]}>
            <div className="problem-cell">
              <Link className="problem-link" to={`/library/${p.id}`} title={`Open ${p.title}`}>
                {p.title}
              </Link>
            </div>
          </TableCell>
          <TableCell label={problemHeaders[1]}>
            <div className="chips" aria-label="Tags">
              {p.tags.map((t) => (
                <Badge
                  variant="secondary"
                  key={t.id}
                  style={tagColour(t)}
                  title={t.name}
                  className="tag-colour chip library-tag"
                >
                  <Link to={`/patterns?tag=${encodeURIComponent(t.id)}`}>{t.name}</Link>
                </Badge>
              ))}
            </div>
          </TableCell>
          <TableCell label={problemHeaders[2]}>
            <Badge variant="secondary" className={`level ${p.difficulty?.toLowerCase()}`}>
              {p.difficulty ?? 'Unknown'}
            </Badge>
          </TableCell>
          <TableCell label={problemHeaders[3]}>
            {p.latestSubmission ? (
              <>
                <Link
                  className={outcomeTone(p.latestSubmission.outcome)}
                  to={`/attempts/${p.latestSubmission.id}`}
                >
                  {enumLabel(p.latestSubmission.outcome)}
                </Link>
                <small>
                  {helpLabel(p.latestSubmission.help)} ·{' '}
                  {languageLabel(p.latestSubmission.language)}
                </small>
                <small>{dateLabel(p.latestSubmission.finishedAt)}</small>
              </>
            ) : (
              'Not submitted'
            )}
          </TableCell>
          <TableCell label={problemHeaders[4]}>
            {duration(p.latestSubmission?.activeSeconds ?? null)}
          </TableCell>
          <TableCell label={problemHeaders[5]}>
            {p.latestConfidence != null ? `${p.latestConfidence} / 5` : 'Not rated'}
            {p.latestSubmission?.confidence == null && p.latestConfidence != null && (
              <small>Earlier submission</small>
            )}
          </TableCell>
          <TableCell label={problemHeaders[6]}>
            {p.nextReviewDate ? dateLabel(p.nextReviewDate) : 'Not scheduled'}
            {p.reviewAction && p.reviewAction !== 'none' && (
              <small>
                {p.reviewAction === 'manual'
                  ? 'Chosen date'
                  : p.reviewAction === 'snooze'
                    ? 'Snoozed'
                    : 'Recommended'}
              </small>
            )}
          </TableCell>
          <TableCell label={problemHeaders[7]}>
            {p.latestSubmission?.notes ? (
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <Button variant="link" className="h-auto p-0">
                    View notes
                  </Button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="notes-dialog-overlay" />
                  <Dialog.Content className="notes-dialog">
                    <Dialog.Title>Attempt notes</Dialog.Title>
                    <Dialog.Description className="muted">{p.title}</Dialog.Description>
                    <div className="notes-dialog-body preserve">{p.latestSubmission.notes}</div>
                    <Dialog.Close asChild>
                      <Button variant="outline">Close</Button>
                    </Dialog.Close>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            ) : (
              'No notes'
            )}
          </TableCell>
        </TableRow>
      ))}
    </ResponsiveTable>
  );
}
