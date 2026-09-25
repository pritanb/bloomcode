import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { ProblemList, Tag } from '../../../shared/contracts';
import { Icon, Field } from '../../components/ui';
import { LibraryTagFilter } from './LibraryTagFilter';
import { filterOptions, type LibraryFilter } from './use-library-params';

/** The library search box, Filters toggle and the collapsible filter grid. */
export function LibraryFilters({
  params,
  setParams,
  filter,
  activeFilters,
  hasFilters,
  filtersOpen,
  setFiltersOpen,
  tags,
  lists,
}: {
  params: URLSearchParams;
  setParams: SetURLSearchParams;
  filter: LibraryFilter;
  activeFilters: number;
  hasFilters: boolean;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  tags: Tag[] | undefined;
  lists: ProblemList[] | undefined;
}) {
  return (
    <>
      <div className="library-toolbar">
        <div className="library-search">
          <Input
            type="search"
            aria-label="Search questions"
            placeholder="Search questions by title or URL…"
            value={params.get('search') ?? ''}
            onChange={(e) => filter('search', e.target.value)}
          />
        </div>
        <Button
          variant={filtersOpen ? 'secondary' : 'outline'}
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Icon icon={SlidersHorizontal} />
          Filters
          {activeFilters > 0 && (
            <span className="filter-count" aria-label={`${activeFilters} active`}>
              {activeFilters}
            </span>
          )}
        </Button>
        {hasFilters && (
          <Button variant="ghost" onClick={() => setParams({})}>
            Reset filters
          </Button>
        )}
      </div>
      <div id="library-filters" className="library-filter-details" hidden={!filtersOpen}>
        <div className="library-filter-grid">
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
    </>
  );
}
