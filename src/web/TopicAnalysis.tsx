import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Brain } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { TopicAnalysisStatus } from '../shared/topic-analysis';
import { api } from './api';
import { Loading } from './ui';

export function TopicAnalysis() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: ['topic-analysis'], queryFn: () => api.get<TopicAnalysisStatus>('/topics/analysis'), refetchInterval: 5000 });
  const action = useMutation({
    mutationFn: () => api.send('/topics/analysis/retry', 'POST', {}),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['topic-analysis'] }); },
  });
  const data = query.data;
  const topics = (data?.report?.topicIds ?? []).flatMap(id => data?.topics.find(t => t.id === id) ?? []);
  const updating = data?.enabled && (data.status === 'pending' || data.status === 'running');
  return <Card className="panel topic-analysis">
    <div className="section-heading"><h2 className="row"><Brain className="icon" aria-hidden="true" />Where to focus</h2>
      {data && !data.hidden && <Button variant="outline" disabled={action.isPending || !!updating || !data.topics.length} onClick={() => action.mutate()}>{updating || action.isPending ? 'Refreshing…' : topics.length ? 'Refresh' : 'Generate recommendations'}</Button>}
    </div>
    {query.isPending ? <Loading /> : query.isError ? <div><p>Couldn’t load your recommendations.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : data?.hidden ? <p>Finish your mixed assessment to see topic recommendations.</p> : <>
      {topics.length > 0 && <ol className="topic-focus-list">{topics.map(topic => <li key={topic.id}><Link to={`/topics/${topic.id}`}>{topic.name}</Link></li>)}</ol>}
      <p className="small muted" role="status">{data?.status === 'failed' ? 'Couldn’t refresh. Try again.' : updating ? 'Updating your focus topics…' : !data?.topics.length ? 'Add topics to get recommendations.' : 'Refreshes weekly.'}</p>
      {action.isError && <p role="alert">Couldn’t start the refresh. Please try again.</p>}
    </>}
  </Card>;
}
