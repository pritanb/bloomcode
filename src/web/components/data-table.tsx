/**
 * DataTable: the kit-style table, built on the shadcn Table primitive (components/ui/table).
 *
 * - Put it inside a <Panel> (or any flex column with a height) and pass `scroll`: the body then
 *   scrolls inside its own region under a sticky header, so the page never scrolls.
 *   Without `scroll` the table grows with its rows and only scrolls sideways when too wide.
 * - Wide tables scroll horizontally in the same region; `stickyFirstColumn` pins the row label.
 * - Sorting: pass `sort` and give sortable columns a `sortLabel` (used in the button's name,
 *   e.g. "Sort by solve time, ascending"). The active column exposes aria-sort.
 * - Rows are <DataTableRow> with <DataTableCell> cells; <CellSub> is a quiet second line.
 * Explicit table roles are kept so assistive tech reads it as a table whatever the styling.
 */
import type { ComponentProps, ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type DataTableColumn = {
  key: string;
  header: ReactNode;
  /** Makes the column sortable; words used in the sort button's accessible name. */
  sortLabel?: string;
  /** Width hints for the header cell, e.g. "min-w-[9rem]". */
  className?: string;
};

export type DataTableSort = {
  key: string;
  direction: 'asc' | 'desc';
  onSort: (key: string) => void;
};

/** Opaque cell backgrounds so sticky cells hide what scrolls beneath them. */
const cellSurface =
  'bg-card transition-colors group-hover/row:bg-[color-mix(in_srgb,var(--muted)_70%,var(--card))] motion-reduce:transition-none';

export function DataTable({
  columns,
  sort,
  scroll = false,
  stickyFirstColumn = false,
  className,
  tableClassName,
  children,
  ...props
}: Omit<ComponentProps<'table'>, 'children'> & {
  columns: readonly DataTableColumn[];
  sort?: DataTableSort;
  /** The body scrolls inside the table region under a sticky header. Give it a height (flex-1). */
  scroll?: boolean;
  stickyFirstColumn?: boolean;
  tableClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-sticky-first={stickyFirstColumn || undefined}
      className={cn(
        // Bleed into the panel padding so cell text lines up with the panel title.
        'group/table relative -mx-3 min-w-0 [&>[data-slot=table-container]]:overflow-visible',
        scroll ? 'min-h-0 flex-1 overflow-auto' : 'overflow-x-auto',
        className,
      )}
    >
      <Table
        role="table"
        className={cn('border-separate border-spacing-0 text-[0.9375rem]', tableClassName)}
        {...props}
      >
        <TableHeader role="rowgroup" className="[&_tr]:border-0">
          <TableRow role="row" className="hover:bg-transparent">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <TableHead
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    'sticky top-0 z-2 h-11 bg-card px-3 text-[0.8125rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]',
                    'group-data-sticky-first/table:first:left-0 group-data-sticky-first/table:first:z-3',
                    active && 'text-foreground',
                    column.className,
                  )}
                >
                  {sort && column.sortLabel ? (
                    <button
                      type="button"
                      onClick={() => sort.onSort(column.key)}
                      aria-label={`Sort by ${column.sortLabel}, ${active && sort.direction === 'asc' ? 'descending' : 'ascending'}`}
                      className="-mx-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 font-medium outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {column.header}
                      {active ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup">{children}</TableBody>
      </Table>
    </div>
  );
}

export function DataTableRow({ className, ...props }: ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      role="row"
      className={cn('group/row border-0 hover:bg-transparent', className)}
      {...props}
    />
  );
}

export function DataTableCell({ className, ...props }: ComponentProps<typeof TableCell>) {
  return (
    <TableCell
      role="cell"
      className={cn(
        cellSurface,
        'border-b px-3 py-3.5 align-top whitespace-normal tabular-nums wrap-break-word group-last/row:border-b-0',
        'group-data-sticky-first/table:first:sticky group-data-sticky-first/table:first:left-0 group-data-sticky-first/table:first:z-1',
        className,
      )}
      {...props}
    />
  );
}

/** A quiet second line inside a cell ("No help · Python", "Recommended"). */
export function CellSub({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground', className)}
      {...props}
    />
  );
}
