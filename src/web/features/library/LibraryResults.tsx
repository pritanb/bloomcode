import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SetURLSearchParams } from 'react-router-dom';
import type { ProblemPage } from '../../../shared/contracts';
import { Empty, ErrorNotice, Loading } from '../../components/ui';
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
      ) : (
        <Empty>
          <h3>
            {params.get('confidence')
              ? 'No questions match this confidence filter'
              : 'No questions found'}
          </h3>
          {params.get('confidence') ? (
            <>
              <p>Only the latest recorded rating is used. Other active filters also apply.</p>
              <Button variant="outline" onClick={() => filter('confidence', '')}>
                Clear confidence filter
              </Button>
            </>
          ) : (
            <p>Add a question or reset your filters to see more.</p>
          )}
        </Empty>
      )}
      <div className="pagination">
        <span className="small muted pagination-range">
          {page.total
            ? `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} of ${page.total}`
            : '0 of 0'}
        </span>
        <div className="pagination-size small muted">
          <span aria-hidden="true">Per page</span>
          <SelectField
            aria-label="Questions per page"
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
          Previous
        </Button>
        <span>
          Page {page.page} of {Math.max(1, Math.ceil(page.total / page.pageSize))}
        </span>
        <Button
          variant="outline"
          disabled={page.page * page.pageSize >= page.total}
          onClick={() => filter('page', String(page.page + 1))}
        >
          Next
        </Button>
      </div>
    </>
  );
}
