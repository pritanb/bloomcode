import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { ProblemPage } from '../../../shared/contracts';
import { ErrorNotice, Loading } from '../../components/ui';
import { EmptyState } from '../../components/kit';
import { ProblemTable } from './ProblemTable';
import {
  defaultDirection,
  defaultSort,
  pageSizeKey,
  pageSizes,
  type LibraryFilter,
} from './use-library-params';

/** The library question table, its empty state and pagination for the current page of results. */
export function LibraryResults({
  query,
  params,
  setParams,
  filter,
}: {
  query: UseQueryResult<ProblemPage>;
  params: URLSearchParams;
  setParams: SetURLSearchParams;
  filter: LibraryFilter;
}) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  const page = query.data;
  return (
    <>
      {page.items.length ? (
        <ProblemTable
          scroll
          problems={page.items}
          sort={params.get('sort') ?? defaultSort}
          direction={(params.get('direction') ?? defaultDirection) === 'desc' ? 'desc' : 'asc'}
          onSort={(sort) => {
            const next = new URLSearchParams(params);
            next.set('sort', sort);
            next.set(
              'direction',
              (params.get('sort') ?? defaultSort) === sort &&
                (params.get('direction') ?? defaultDirection) === 'asc'
                ? 'desc'
                : 'asc',
            );
            next.set('page', '1');
            setParams(next, { replace: true });
          }}
        />
      ) : params.get('confidence') ? (
        <EmptyState
          className="flex-1"
          icon={SearchX}
          title="No questions match this confidence filter"
          description="Only the latest recorded rating is used. Other active filters also apply."
          action={
            <Button variant="outline" onClick={() => filter('confidence', '')}>
              Clear confidence filter
            </Button>
          }
        />
      ) : (
        <EmptyState
          className="flex-1"
          icon={SearchX}
          title="No questions found"
          description="Add a question or reset your filters to see more."
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t pt-3.5 text-sm tabular-nums">
        <span className="mr-auto text-[0.8125rem] text-muted-foreground">
          {page.total
            ? `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} of ${page.total}`
            : '0 of 0'}
        </span>
        <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <span aria-hidden="true">Per page</span>
          <SelectField
            aria-label="Questions per page"
            className="w-[4.75rem]"
            value={String(page.pageSize)}
            onValueChange={(value) => {
              try {
                localStorage.setItem(pageSizeKey, value);
              } catch {
                /* The URL still carries the size. */
              }
              filter('pageSize', value);
            }}
          >
            {pageSizes.map((size) => (
              <SelectOption key={size} value={String(size)}>
                {size}
              </SelectOption>
            ))}
          </SelectField>
        </div>
        <Button
          variant="outline"
          disabled={page.page <= 1}
          onClick={() => filter('page', String(page.page - 1))}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <span className="text-muted-foreground">
          Page {page.page} of {Math.max(1, Math.ceil(page.total / page.pageSize))}
        </span>
        <Button
          variant="outline"
          disabled={page.page * page.pageSize >= page.total}
          onClick={() => filter('page', String(page.page + 1))}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}
