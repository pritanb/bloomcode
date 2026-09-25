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

export const outcomeTone = (outcome: string | null | undefined) =>
  outcome === 'solved' ? 'up' : outcome === 'not_solved' ? 'warn' : '';
