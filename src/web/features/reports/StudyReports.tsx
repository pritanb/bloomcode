import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Dashboard } from '../../../shared/contracts';
import { api } from '../../app/api';
import { WeeklyRecap } from './WeeklyRecap';
import { Loading, ErrorNotice } from '../../components/ui';
export function StudyReport() {
  const query = useQuery({
    queryKey: ['study-report'],
    queryFn: async () => ({ activity: (await api.get<Dashboard>('/dashboard')).activity }),
  });
  return (
    <>
      <Link
        className="mb-4 inline-flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground hover:no-underline"
        to="/"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to study desk
      </Link>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice error={query.error} />
      ) : (
        <WeeklyRecap activity={query.data.activity} />
      )}
    </>
  );
}
