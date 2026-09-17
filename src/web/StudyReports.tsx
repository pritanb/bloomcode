import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Dashboard, Settings } from '../shared/contracts';
import { api } from './api';
import { ReviewCalendar } from './ReviewCalendar';
import { WeeklyRecap } from './WeeklyRecap';
import { Loading, ErrorNotice } from './ui';
export function StudyReport({ calendar = false }: { calendar?: boolean }) {
  const query = useQuery({ queryKey: ['study-report', calendar], queryFn: async () => calendar ? { timezone: (await api.get<Settings>('/settings')).timezone, activity: [] } : { timezone: '', activity: (await api.get<Dashboard>('/dashboard')).activity } });
  return <><Link className="back-link" to="/">← Back to study desk</Link>{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : calendar ? <ReviewCalendar timezone={query.data.timezone!} /> : <WeeklyRecap activity={query.data.activity} />}</>;
}
