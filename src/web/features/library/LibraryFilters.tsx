import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { ProblemList, Tag } from '../../../shared/contracts';
import { Field } from '../../components/ui';
import { LibraryTagFilter } from './LibraryTagFilter';
import { filterOptions, type LibraryFilter } from './use-library-params';

const toolbarControl = 'h-10 rounded-xl';

/** The library search box, Filters toggle and Reset, shown in the results panel header. */
export function LibrarySearch({
  params,
  setParams,
  filter,
  activeFilters,
  hasFilters,
  filtersOpen,
  setFiltersOpen,
}: {
  params: URLSearchParams;
  setParams: SetURLSearchParams;
  filter: LibraryFilter;
  activeFilters: number;
  hasFilters: boolean;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <div className="relative w-64 xl:w-80">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          className={`${toolbarControl} pl-10`}
          aria-label="Search questions"
          placeholder="Search questions by title or URL…"
          value={params.get('search') ?? ''}
          onChange={(e) => filter('search', e.target.value)}
        />
      </div>
      <Button
        variant={filtersOpen ? 'secondary' : 'outline'}
        className={`${toolbarControl} px-3.5`}
        aria-expanded={filtersOpen}
        aria-controls="library-filters"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {activeFilters > 0 && (
          <span
            className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-bold text-primary-foreground tabular-nums"
            aria-label={`${activeFilters} active`}
          >
            {activeFilters}
          </span>
        )}
      </Button>
      {hasFilters && (
        <Button variant="ghost" className={toolbarControl} onClick={() => setParams({})}>
          Reset filters
        </Button>
      )}
    </div>
  );
}

/** The collapsible filter grid under the results header. */
export function LibraryFilters({
  params,
  filter,
  filtersOpen,
  tags,
  lists,
}: {
  params: URLSearchParams;
  filter: LibraryFilter;
  filtersOpen: boolean;
  tags: Tag[] | undefined;
  lists: ProblemList[] | undefined;
}) {
  return (
    <div
      id="library-filters"
      hidden={!filtersOpen}
      className="shrink-0 rounded-2xl bg-muted p-4 [&_[data-slot=input]]:bg-card [&_[data-slot=select-trigger]]:bg-card [&_[data-slot=select-trigger]]:w-full"
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-3">
        <Field label="LeetCode topic">
          <Input
            value={params.get('leetcodeTopic') ?? ''}
            onChange={(event) => filter('leetcodeTopic', event.target.value)}
            placeholder="e.g. Binary Search"
          />
        </Field>
        <Field label="Latest submission">
          <SelectField
            value={params.get('status') ?? 'all'}
            onValueChange={(value) => filter('status', value)}
          >
            <SelectOption value="all">All questions</SelectOption>
            <SelectOption value="solved">Solved</SelectOption>
            <SelectOption value="not_solved">Not solved</SelectOption>
            <SelectOption value="stopped">Stopped</SelectOption>
            <SelectOption value="not_submitted">Not submitted</SelectOption>
          </SelectField>
        </Field>
        <Field label="Difficulty">
          <SelectField
            value={params.get('difficulty') ?? ''}
            onValueChange={(value) => filter('difficulty', value)}
          >
            <SelectOption value="">All difficulties</SelectOption>
            {['Easy', 'Medium', 'Hard'].map((level) => (
              <SelectOption key={level}>{level}</SelectOption>
            ))}
          </SelectField>
        </Field>
        <LibraryTagFilter params={params} filter={filter} tags={tags} />
        <Field label="List">
          <SelectField
            value={params.get('listId') ?? ''}
            onValueChange={(value) => filter('listId', value)}
          >
            <SelectOption value="">All lists</SelectOption>
            {lists?.map((list) => (
              <SelectOption key={list.id} value={list.id}>
                {list.name}
              </SelectOption>
            ))}
          </SelectField>
        </Field>
        <Field label="Solve time">
          <SelectField
            value={params.get('timeBucket') ?? ''}
            onValueChange={(value) => filter('timeBucket', value)}
          >
            {filterOptions.timeBucket.map((value) => (
              <SelectOption key={value} value={value}>
                {value === '' ? 'Any time' : value === 'unknown' ? 'Unknown' : `${value} min`}
              </SelectOption>
            ))}
          </SelectField>
        </Field>
        <Field label="Attempt confidence">
          <SelectField
            value={params.get('confidence') ?? ''}
            onValueChange={(value) => filter('confidence', value)}
            title="Latest recorded confidence rating"
          >
            <SelectOption value="">Any confidence</SelectOption>
            <SelectOption value="low">Low (below 3)</SelectOption>
            <SelectOption value="medium">Medium (3 to under 4)</SelectOption>
            <SelectOption value="high">High (4–5)</SelectOption>
            <SelectOption value="unknown">Not recorded</SelectOption>
          </SelectField>
        </Field>
      </div>
    </div>
  );
}
