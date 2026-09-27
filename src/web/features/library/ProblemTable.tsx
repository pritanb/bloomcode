import { enumLabel, helpLabel, languageLabel } from '../../lib/labels';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Link } from 'react-router-dom';
import type { Problem } from '../../../shared/contracts';
import { dateLabel, duration } from '../../components/ui';
import {
  CellSub,
  DataTable,
  DataTableCell,
  DataTableRow,
  type DataTableColumn,
} from '../../components/data-table';
import {
  SidePanel,
  SidePanelContent,
  SidePanelDescription,
  SidePanelTitle,
  SidePanelTrigger,
} from '../../components/kit';
import { outcomeText } from './library-utils';
import { DifficultyBadge, TagBadge } from './tags';

const columns: DataTableColumn[] = [
  { key: 'title', header: 'Question', sortLabel: 'question title', className: 'min-w-[13rem]' },
  { key: 'tags', header: 'Tags', className: 'w-[10rem] min-w-[10rem]' },
  { key: 'difficulty', header: 'Difficulty', sortLabel: 'difficulty' },
  {
    key: 'lastAttempt',
    header: 'Latest submission',
    sortLabel: 'last attempt',
    className: 'min-w-[10rem]',
  },
  { key: 'solveTime', header: 'LeetCode time', sortLabel: 'solve time' },
  { key: 'confidence', header: 'Confidence', sortLabel: 'confidence' },
  { key: 'reviewDate', header: 'Next review', sortLabel: 'next review', className: 'min-w-[8rem]' },
  { key: 'notes', header: 'Attempt notes' },
];

function AttemptNotes({ problem }: { problem: Problem }) {
  return (
    <SidePanel>
      <SidePanelTrigger asChild>
        <Button variant="ghost" size="sm" className="-mx-2 -my-0.5">
          <FileText aria-hidden="true" />
          View notes
        </Button>
      </SidePanelTrigger>
      <SidePanelContent closeLabel="Close attempt notes">
        <SidePanelTitle>Attempt notes</SidePanelTitle>
        <SidePanelDescription className="-mt-2 text-[0.9375rem] text-muted-foreground">
          {problem.title}
        </SidePanelDescription>
        <div className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap wrap-anywhere">
          {problem.latestSubmission?.notes}
        </div>
        <Dialog.Close asChild>
          <Button variant="outline" className="self-end">
            Close
          </Button>
        </Dialog.Close>
      </SidePanelContent>
    </SidePanel>
  );
}

export function ProblemTable({
  problems,
  sort = 'title',
  direction = 'asc',
  onSort,
  scroll = false,
}: {
  problems: Problem[];
  sort?: string;
  direction?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Scroll the rows inside the table region under a sticky header (library page). */
  scroll?: boolean;
}) {
  return (
    <DataTable
      columns={columns}
      scroll={scroll}
      stickyFirstColumn
      aria-label="Questions"
      sort={onSort ? { key: sort, direction, onSort } : undefined}
    >
      {problems.map((p) => (
        <DataTableRow key={p.id}>
          <DataTableCell>
            <Link
              className="font-medium tracking-[-0.005em] text-foreground no-underline hover:underline hover:decoration-border"
              to={`/library/${p.id}`}
              title={`Open ${p.title}`}
            >
              {p.title}
            </Link>
          </DataTableCell>
          <DataTableCell>
            <div className="flex w-[9rem] max-w-full flex-wrap gap-1" aria-label="Tags">
              {p.tags.map((t) => (
                <TagBadge key={t.id} tag={t} />
              ))}
            </div>
          </DataTableCell>
          <DataTableCell>
            <DifficultyBadge difficulty={p.difficulty} />
          </DataTableCell>
          <DataTableCell>
            {p.latestSubmission ? (
              <>
                <Link
                  className={`font-medium no-underline hover:underline ${outcomeText(p.latestSubmission.outcome)}`}
                  to={`/attempts/${p.latestSubmission.id}`}
                >
                  {enumLabel(p.latestSubmission.outcome)}
                </Link>
                <CellSub>
                  {helpLabel(p.latestSubmission.help)} ·{' '}
                  {languageLabel(p.latestSubmission.language)}
                </CellSub>
                <CellSub>{dateLabel(p.latestSubmission.finishedAt)}</CellSub>
              </>
            ) : (
              <span className="text-muted-foreground">Not submitted</span>
            )}
          </DataTableCell>
          <DataTableCell>{duration(p.latestSubmission?.activeSeconds ?? null)}</DataTableCell>
          <DataTableCell>
            {p.latestConfidence != null ? (
              <>
                {p.latestConfidence}
                <span className="text-muted-foreground"> / 5</span>
              </>
            ) : (
              <span className="text-muted-foreground">Not rated</span>
            )}
            {p.latestSubmission?.confidence == null && p.latestConfidence != null && (
              <CellSub>Earlier submission</CellSub>
            )}
          </DataTableCell>
          <DataTableCell>
            {p.nextReviewDate ? (
              dateLabel(p.nextReviewDate)
            ) : (
              <span className="text-muted-foreground">Not scheduled</span>
            )}
            {p.reviewAction && p.reviewAction !== 'none' && (
              <CellSub>
                {p.reviewAction === 'manual'
                  ? 'Chosen date'
                  : p.reviewAction === 'snooze'
                    ? 'Snoozed'
                    : 'Recommended'}
              </CellSub>
            )}
          </DataTableCell>
          <DataTableCell>
            {p.latestSubmission?.notes ? (
              <AttemptNotes problem={p} />
            ) : (
              <span className="text-muted-foreground">No notes</span>
            )}
          </DataTableCell>
        </DataTableRow>
      ))}
    </DataTable>
  );
}
