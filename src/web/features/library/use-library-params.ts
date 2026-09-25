import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// The library opens on the most recent practice; the API keeps its own title order.
export const defaultSort = 'lastAttempt';
export const defaultDirection = 'desc';
export const filterOptions: Record<string, string[]> = {
  status: ['all', 'solved', 'not_solved', 'stopped', 'not_submitted'],
  tagMode: ['any', 'all'],
  difficulty: ['', 'Easy', 'Medium', 'Hard'],
  timeBucket: ['', '0-10', '10-20', '20-30', '30-45', '45+', 'unknown'],
  sort: ['title', 'lastAttempt', 'solveTime', 'reviewDate', 'tagDifficulty'],
  direction: ['asc', 'desc'],
};
const libraryFiltersKey = 'library-filters';
export const pageSizeKey = 'library-page-size';
export const pageSizes = [25, 50, 100];
function storedPageSize() {
  try {
    const stored = localStorage.getItem(pageSizeKey);
    if (stored && pageSizes.includes(Number(stored))) return stored;
  } catch {
    /* Fall back to the default size. */
  }
  return '25';
}

/** The library's filters, sort and page live in the URL; this owns reading and writing them. */
export function useLibraryParams() {
  const [params, setParams] = useSearchParams();
  // A bare /library visit (e.g. from the sidebar) brings back the filters last used this session;
  // links that carry their own filters take precedence.
  const [restoring, setRestoring] = useState(() => {
    if (params.size > 0) return false;
    try {
      return !!sessionStorage.getItem(libraryFiltersKey);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (restoring) {
      try {
        setParams(new URLSearchParams(sessionStorage.getItem(libraryFiltersKey) ?? ''), {
          replace: true,
        });
      } catch {
        /* Start with default filters. */
      }
      setRestoring(false);
      return;
    }
    try {
      sessionStorage.setItem(libraryFiltersKey, params.toString());
    } catch {
      /* Filters still live in the URL. */
    }
  }, [params, restoring, setParams]);
  // Older library links used overlapping practice-history filters.
  useEffect(() => {
    const status = params.get('status');
    if (status !== 'completed' && status !== 'attempted' && status !== 'unsolved') return;
    const next = new URLSearchParams(params);
    next.set(
      'status',
      status === 'completed' ? 'solved' : status === 'unsolved' ? 'not_submitted' : 'all',
    );
    next.set('page', '1');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const activeFilters = [...params.entries()].filter(
    ([key, value]) =>
      ![
        'page',
        'pageSize',
        'search',
        'sort',
        'direction',
        'tagDifficultyMin',
        'tagDifficultyMax',
      ].includes(key) &&
      value &&
      value !== (filterOptions[key]?.[0] ?? ''),
  ).length;
  const hasFilters = activeFilters > 0 || !!params.get('search');
  // The API request always carries an explicit page, size and sort.
  const queryParams = new URLSearchParams(params);
  queryParams.delete('tagDifficultyMin');
  queryParams.delete('tagDifficultyMax');
  if (!queryParams.has('page')) queryParams.set('page', '1');
  if (!queryParams.has('pageSize')) queryParams.set('pageSize', storedPageSize());
  if (!queryParams.has('sort')) queryParams.set('sort', defaultSort);
  if (!queryParams.has('direction')) queryParams.set('direction', defaultDirection);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('tagDifficultyMin');
    next.delete('tagDifficultyMax');
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: true });
  }
  return { params, setParams, restoring, activeFilters, hasFilters, queryParams, filter };
}

export type LibraryFilter = (key: string, value: string) => void;
