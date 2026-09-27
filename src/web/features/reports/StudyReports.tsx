import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Dashboard, Settings } from '../../../shared/contracts';
import { api } from '../../app/api';
import { ReviewCalendar } from './ReviewCalendar';
import { WeeklyRecap } from './WeeklyRecap';
import { Loading, ErrorNotice } from '../../components/ui';
import { PageHeader } from '../../components/kit';
export function StudyReport({ calendar = false }: { calendar?: boolean }) {
  const query = useQuery({
    queryKey: ['study-report', calendar],
    queryFn: async () =>
      calendar
        ? { timezone: (await api.get<Settings>('/settings')).timezone, activity: [] }
        : { timezone: '', activity: (await api.get<Dashboard>('/dashboard')).activity },
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
      ) : calendar ? (
        <>
          <PageHeader title="Reviews" description={`Scheduled reviews · ${query.data.timezone}`} />
          <ReviewCalendar timezone={query.data.timezone!} />
        </>
      ) : (
        <WeeklyRecap activity={query.data.activity} />
      )}
    </>
  );
}
