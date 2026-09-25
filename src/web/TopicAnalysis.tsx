import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Brain } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TOPIC_READINESS_TARGET, type TopicAnalysisStatus } from '../shared/topic-analysis';
import { api } from './api';
import { Loading } from './ui';
import { tutorProblem } from './analysis-status';

export function TopicAnalysis() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['topic-analysis'],
    queryFn: () => api.get<TopicAnalysisStatus>('/topics/analysis'),
    refetchInterval: 5000,
  });
  const action = useMutation({
    mutationFn: () => api.send('/topics/analysis/retry', 'POST', {}),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['topic-analysis'] });
    },
  });
  const data = query.data;
  const topics = (data?.report?.topicIds ?? []).flatMap((id, i) => {
    const topic = data?.topics.find((t) => t.id === id);
    return topic ? [{ ...topic, reason: data?.report?.reasons?.[i] }] : [];
  });
  const updating = data?.enabled && (data.status === 'pending' || data.status === 'running');
  const problem = tutorProblem(data?.runner);
  return (
    <Card className="panel topic-analysis">
      <div className="section-heading">
        <h2 className="section-title">
          <Brain className="icon" aria-hidden="true" />
          Where to focus
        </h2>
        {data && !data.hidden && (
          <Button
            variant="outline"
            disabled={action.isPending || !!updating || !data.topics.length}
            onClick={() => action.mutate()}
          >
            {updating || action.isPending
              ? 'Refreshing…'
              : topics.length
                ? 'Refresh'
                : 'Generate recommendations'}
          </Button>
        )}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <div>
          <p>Couldn’t load your recommendations.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : data?.hidden ? (
        <p>Finish your mixed assessment to see topic recommendations.</p>
      ) : (
        <>
          {topics.length > 0 && (
            <ol className="focus-grid">
              {topics.map((topic, i) => (
                <li key={topic.id}>
                  <Link
                    to={`/topics/${topic.id}`}
                    className={i === 0 ? 'focus-tile focus-tile-top' : 'focus-tile'}
                    aria-label={`Priority ${i + 1}: ${topic.name}`}
                  >
                    <span className="focus-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <h3 className="focus-name">{topic.name}</h3>
                    <div>
                      <p className="focus-score">
                        {topic.score === null ? (
                          <span className="muted">Not yet assessed</span>
                        ) : (
                          <>
                            <strong>{topic.score.toFixed(1)}</strong>
                            <span>/ 5</span>
                          </>
                        )}
                      </p>
                      <div
                        className="focus-meter"
                        role="img"
                        aria-label={
                          topic.score === null
                            ? 'Not yet assessed'
                            : `Score ${topic.score} of 5, target ${TOPIC_READINESS_TARGET}`
                        }
                      >
                        <i style={{ width: `${((topic.score ?? 0) / 5) * 100}%` }} />
                      </div>
                    </div>
                    {topic.reason && (
                      <p className="small focus-reason" title={topic.reason}>
                        {topic.reason}
                      </p>
                    )}
                    <span className="focus-link">
                      View topic <ArrowRight className="icon" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {(problem || updating || data?.status === 'failed' || !data?.topics.length) && (
            <p className="small muted" role="status">
              {problem
                ? `${problem.title}. ${problem.detail}`
                : data?.status === 'failed'
                  ? 'Couldn’t refresh. Try again.'
                  : updating
                    ? 'Updating your focus topics…'
                    : 'Add topics to get recommendations.'}
            </p>
          )}
          {action.isError && <p role="alert">Couldn’t start the refresh. Please try again.</p>}
        </>
      )}
    </Card>
  );
}
