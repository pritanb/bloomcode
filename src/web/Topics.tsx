import { enumLabel, helpLabel } from './labels';
import { Card } from '@/components/ui/card';
import { SelectField, SelectOption } from '@/components/select-field';
import { ArrowLeft, BookOpen, History, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { Topic, TopicDetail as TopicData } from '../shared/contracts';
import { api } from './api';
import { TopicProgress } from './TopicProgress';
import { ProblemTable } from './Library';
import {
  Icon,
  SectionTitle,
  AttemptList,
  dateLabel,
  duration,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  MovementList,
  PageTitle,
} from './ui';
export function Topics() {
  const query = useQuery({
    queryKey: ['topics'],
    queryFn: () => api.get<Topic[]>('/topics'),
  });
  return (
    <>
      <PageTitle
        title="Topic progress"
        description="Find your highest-priority topics and track progress toward interview readiness."
      />
      {query.isPending ? <Loading /> : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : <TopicProgress topics={query.data} />}
    </>
  );
}
export function TopicDetail() {
  const { id } = useParams();
  const [evidence, setEvidence] = useState('');
  const [help, setHelp] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const query = useQuery({
    queryKey: ['topic', id],
    queryFn: () => api.get<TopicData>(`/topics/${id}`),
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const d = query.data;
  const attempts = d.attempts.filter(
    (a) =>
      (!evidence || a.evidence === evidence) &&
      (!help || a.help === help) &&
      (!difficulty || a.problem.difficulty === difficulty),
  );
  return (
    <>
      <Link className="back-link" to="/topics">
        <Icon icon={ArrowLeft} />
        Back to topic progress
      </Link>
      <PageTitle
        title={d.topic.name}
        description={`Last reviewed: ${dateLabel(d.topic.lastReviewed)}${d.topic.provisional ? ' · Provisional evidence' : ''}`}
      >
        <div className="detail-score">
          <strong>{d.topic.score ?? 'Unrated'}</strong>
          {d.topic.score !== null && <span> / 5</span>}
        </div>
      </PageTitle>
      {d.topic.notes && <p className="topic-notes preserve">{d.topic.notes}</p>}
      <div className="topic-insight">
        <div>
          <strong>{d.stats.attemptCount}</strong>
          <span>Recorded attempts</span>
        </div>
        <div>
          <strong>{duration(d.stats.medianSeconds)}</strong>
          <span>Median known active time</span>
        </div>
        <p className="small muted">
          {d.stats.knownTimeCount} of {d.stats.attemptCount} attempts have known
          times. Unknown durations are excluded. This summary includes different
          help and evidence types; compare like for like below.
        </p>
      </div>
      <div className="topic-detail-layout fill-page">
      <Card className="panel">
        <SectionTitle icon={ListChecks}>Score history & rationale</SectionTitle>
        <MovementList items={d.decisions} />
      </Card>
      <Card className="panel">
        <SectionTitle icon={History}>Practice history</SectionTitle>
        <div className="row history-filters">
          <Field label="Evidence type">
            <SelectField
              value={evidence}
              onValueChange={(value) => setEvidence(value)}
            >
              <SelectOption value="">All evidence</SelectOption>
              {['retention', 'near_transfer', 'unseen', 'mock'].map((v) => (
                <SelectOption key={v} value={v}>
                  {enumLabel(v)}
                </SelectOption>
              ))}
            </SelectField>
          </Field>
          <Field label="Help filter">
            <SelectField value={help} onValueChange={(value) => setHelp(value)}>
              <SelectOption value="">All help levels</SelectOption>
              {['none', 'small', 'major', 'solution', 'unknown'].map((v) => (
                <SelectOption key={v} value={v}>{helpLabel(v)}</SelectOption>
              ))}
            </SelectField>
          </Field>
          <Field label="Question difficulty filter">
            <SelectField
              value={difficulty}
              onValueChange={(value) => setDifficulty(value)}
            >
              <SelectOption value="">All difficulties</SelectOption>
              {['Easy', 'Medium', 'Hard'].map((v) => (
                <SelectOption key={v}>{v}</SelectOption>
              ))}
            </SelectField>
          </Field>
        </div>
        <AttemptList items={attempts} />
      </Card>
      <Card className="panel topic-related">
        <SectionTitle icon={BookOpen}>Related questions</SectionTitle>
        <p className="small muted">
          Selecting a related question is targeted practice, not an unseen
          assessment.
        </p>
        {d.problems.length ? (
          <ProblemTable problems={d.problems} />
        ) : (
          <Empty>No questions are linked to this topic yet.</Empty>
        )}
      </Card>
      </div>
    </>
  );
}
