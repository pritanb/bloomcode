import { enumLabel, helpLabel } from '../../lib/labels';
import { SelectField, SelectOption } from '@/components/select-field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  BookOpen,
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Gauge,
  History,
  ListChecks,
  Minus,
  Timer,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type {
  Attempt,
  ScoreDecision,
  Topic,
  TopicDetail as TopicData,
} from '../../../shared/contracts';
import { api } from '../../app/api';
import { TopicProgress } from './TopicProgress';
import { ProblemTable } from '../library/Library';
import { dateLabel, duration, ErrorNotice, Field, Loading } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  List,
  ListRow,
  PageHeader,
  Panel,
  ScrollRegion,
  StatTile,
  type Tone,
} from '../../components/kit';

export function Topics() {
  const query = useQuery({
    queryKey: ['topics'],
    queryFn: () => api.get<Topic[]>('/topics'),
  });
  return (
    <>
      <PageHeader
        title="Topic progress"
        description="Your priority topics and progress toward interview readiness."
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <TopicProgress topics={query.data} />
      )}
    </>
  );
}

const Dot = () => <span aria-hidden="true">·</span>;

function DecisionList({ items }: { items: ScoreDecision[] }) {
  if (!items.length)
    return (
      <EmptyState
        icon={TrendingUp}
        title="No score decisions yet"
        description="Scores change when attempts or reviews support them."
      />
    );
  return (
    <List>
      {items.map((item) => {
        const up = item.newScore > item.oldScore;
        const down = item.newScore < item.oldScore;
        return (
          <ListRow
            key={item.id}
            icon={up ? TrendingUp : down ? TrendingDown : Minus}
            tone={up ? 'emerald' : down ? 'rose' : 'neutral'}
            title={
              <span className="tabular-nums">
                {item.oldScore === item.newScore
                  ? 'No change'
                  : `${item.oldScore} → ${item.newScore}`}
              </span>
            }
            trailing={dateLabel(item.date)}
          >
            <p className="text-[0.9375rem] leading-relaxed">{item.rationale}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
              <span>{enumLabel(item.evidence)}</span>
              {item.attemptId && (
                <>
                  <Dot />
                  <Link to={`/attempts/${item.attemptId}`}>View evidence</Link>
                </>
              )}
            </div>
          </ListRow>
        );
      })}
    </List>
  );
}

const outcomeIcon = (a: Attempt): { icon: LucideIcon; tone: Tone } =>
  a.status !== 'completed'
    ? { icon: Clock, tone: 'neutral' }
    : a.outcome === 'solved'
      ? { icon: CircleCheck, tone: 'emerald' }
      : a.outcome === 'not_solved'
        ? { icon: CircleX, tone: 'rose' }
        : { icon: CircleSlash, tone: 'neutral' };

function PracticeList({ items }: { items: Attempt[] }) {
  if (!items.length)
    return (
      <EmptyState
        icon={History}
        title="No practice recorded yet"
        description="Start a question to save your first attempt."
      />
    );
  return (
    <List>
      {items.map((a) => (
        <ListRow
          key={a.id}
          {...outcomeIcon(a)}
          title={a.problem.title}
          to={`/attempts/${a.id}`}
          trailing={dateLabel(a.finishedAt ?? a.startedAt)}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">
                {enumLabel(a.outcome ?? a.status)}
              </span>
              <Dot />
              <span className="tabular-nums" title="Active time">
                {duration(a.activeSeconds)}
              </span>
              <Dot />
              <span>
                {enumLabel(a.evidence)}, {helpLabel(a.help).toLowerCase()}
              </span>
              <Dot />
              <span>
                {a.status !== 'completed'
                  ? 'In progress'
                  : a.feedback
                    ? 'Tutor note saved'
                    : 'No tutor note'}
              </span>
            </span>
          }
        />
      ))}
    </List>
  );
}

function TabLabel({
  icon: Glyph,
  label,
  count,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <>
      <Glyph aria-hidden="true" />
      {label}
      <span className="min-w-5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
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
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  const d = query.data;
  const attempts = d.attempts.filter(
    (a) =>
      (!evidence || a.evidence === evidence) &&
      (!help || a.help === help) &&
      (!difficulty || a.problem.difficulty === difficulty),
  );
  const score: ReactNode = d.topic.score === null ? 'Unrated' : d.topic.score;
  return (
    <>
      <Link
        className="mb-3 inline-flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground hover:no-underline [&>svg]:size-4"
        to="/topics"
      >
        <ArrowLeft aria-hidden="true" />
        Back to topic progress
      </Link>
      <PageHeader
        title={d.topic.name}
        description={
          <>
            Last reviewed: {dateLabel(d.topic.lastReviewed)}
            {d.topic.notes && (
              <span className="mt-1 block whitespace-pre-wrap">{d.topic.notes}</span>
            )}
          </>
        }
      />
      <FillPage>
        <div className="grid shrink-0 gap-4 md:grid-cols-3">
          <StatTile
            label="Current score"
            icon={Gauge}
            tone="solid"
            value={score}
            unit={d.topic.score === null ? undefined : '/ 5'}
            sub={
              d.topic.provisional ? (
                <span className="text-warn">Provisional evidence</span>
              ) : (
                '1–5 readiness scale'
              )
            }
          />
          <StatTile
            label="Recorded attempts"
            icon={ListChecks}
            tone="sky"
            value={d.stats.attemptCount}
            sub="All help and evidence types"
          />
          <StatTile
            label="Median active time"
            icon={Timer}
            tone="amber"
            value={duration(d.stats.medianSeconds)}
            sub={`Known times only · ${d.stats.knownTimeCount} of ${d.stats.attemptCount} attempts`}
          />
        </div>
        <Panel className="min-h-0 flex-1">
          <Tabs defaultValue="scores" className="min-h-0 flex-1">
            <TabsList aria-label="Topic records">
              <TabsTrigger value="scores">
                <TabLabel icon={TrendingUp} label="Score history" count={d.decisions.length} />
              </TabsTrigger>
              <TabsTrigger value="practice">
                <TabLabel icon={History} label="Practice history" count={attempts.length} />
              </TabsTrigger>
              <TabsTrigger value="related">
                <TabLabel icon={BookOpen} label="Related questions" count={d.problems.length} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scores" className="flex flex-col">
              <ScrollRegion>
                <DecisionList items={d.decisions} />
              </ScrollRegion>
            </TabsContent>
            <TabsContent value="practice" className="flex flex-col gap-3">
              <div className="grid shrink-0 gap-3 sm:grid-cols-[repeat(3,minmax(0,15rem))]">
                <Field label="Evidence type">
                  <SelectField value={evidence} onValueChange={(value) => setEvidence(value)}>
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
                      <SelectOption key={v} value={v}>
                        {helpLabel(v)}
                      </SelectOption>
                    ))}
                  </SelectField>
                </Field>
                <Field label="Question difficulty filter">
                  <SelectField value={difficulty} onValueChange={(value) => setDifficulty(value)}>
                    <SelectOption value="">All difficulties</SelectOption>
                    {['Easy', 'Medium', 'Hard'].map((v) => (
                      <SelectOption key={v}>{v}</SelectOption>
                    ))}
                  </SelectField>
                </Field>
              </div>
              <ScrollRegion>
                <PracticeList items={attempts} />
              </ScrollRegion>
            </TabsContent>
            <TabsContent value="related" className="flex flex-col gap-3">
              <p className="shrink-0 text-[0.8125rem] text-muted-foreground">
                Practising these counts as targeted, not an unseen assessment.
              </p>
              {d.problems.length ? (
                <div className="relative -mx-1 min-h-0 flex-1 overflow-auto px-1 [&_[data-slot=table-container]]:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-1 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)]">
                  <ProblemTable problems={d.problems} />
                </div>
              ) : (
                <EmptyState icon={BookOpen} title="No questions are linked to this topic yet." />
              )}
            </TabsContent>
          </Tabs>
        </Panel>
      </FillPage>
    </>
  );
}
