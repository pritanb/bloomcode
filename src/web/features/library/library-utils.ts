import { useQuery } from '@tanstack/react-query';
import type { ProblemList, Tag } from '../../../shared/contracts';
import { api } from '../../app/api';

export function useCatalogue() {
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  });
  const lists = useQuery({
    queryKey: ['lists'],
    queryFn: () => api.get<ProblemList[]>('/lists'),
  });
  return { tags, lists };
}

/** Text colour for a submission outcome: solved reads as up, not solved as a warning. */
export const outcomeText = (outcome: string | null | undefined) =>
  outcome === 'solved' ? 'text-up' : outcome === 'not_solved' ? 'text-warn' : 'text-foreground';
