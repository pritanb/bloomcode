import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, Focus, Lightbulb, Lock, Repeat, Sparkles } from 'lucide-react';
import type { Finding, InsightStatus, Observation } from '../../../shared/insights';
import { AnalysisStatus } from './AnalysisStatus';
import { api } from '../../app/api';
import { Loading, ErrorNotice, Field, dateLabel } from '../../components/ui';
import { Disclosure } from '../../components/disclosure';
import {
  Callout,
  EmptyState,
  FillPage,
  IconTile,
  List,
  ListRow,
  Meter,
  PageHeader,
  Panel,
  ScrollRegion,
  SectionHeader,
  SidePanel,
  SidePanelContent,
  SidePanelDescription,
  SidePanelTitle,
  SidePanelTrigger,
  Subheading,
  Tile,
  TileGrid,
  TileTitle,
  ToneBadge,
  type Tone,
} from '../../components/kit';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const evidenceLabels = {
  learner_reported: 'You reported',
  code_inferred: 'Inferred from code',
  outcome_observed: 'Recorded result',
};
function Evidence({
  observation,
  onDismiss,
}: {
  observation: Observation & { problemTitle: string; studyDate: string };
  onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api.send(`/insights/observations/${observation.id}/dismiss`, 'POST', { reason }),
    onSuccess: () => {
      setEditing(false);
      onDismiss();
    },
  });
  return (
    <ListRow
      title={observation.problemTitle}
      to={`/attempts/${observation.attemptId}`}
      trailing={dateLabel(observation.studyDate)}
    >
      <p className="text-[0.9375rem]">
        <ToneBadge className="mr-1.5 align-middle">
          {evidenceLabels[observation.evidenceType]}
        </ToneBadge>
        {observation.summary}
      </p>
      <blockquote className="my-1.5 max-h-56 overflow-auto rounded-xl bg-muted p-3 whitespace-pre-wrap wrap-anywhere">
        {observation.excerpt}
      </blockquote>
      <span className="text-xs text-muted-foreground">Source: {observation.sourceField}</span>
      {editing ? (
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="What did the tutor misunderstand?">
            <Textarea
              autoFocus
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Your correction is kept and used in future analysis. This evidence will be excluded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!reason.trim() || mutation.isPending}>
              Dismiss observation
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {mutation.isError && <ErrorNotice error={mutation.error} />}
        </form>
      ) : (
        <Button
          className="-ml-2 self-start"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
        >
          Correct this observation
        </Button>
      )}
    </ListRow>
  );
}
const findingLabels = {
  recurring: 'Across multiple problems',
  improvement: 'Signs of improvement',
  single_problem: 'On one problem',
  focus: 'Focus area',
};
const findingTiles: Record<Finding['kind'], { icon: typeof Repeat; tone: Tone }> = {
  recurring: { icon: Repeat, tone: 'rose' },
  improvement: { icon: Check, tone: 'emerald' },
  single_problem: { icon: Lightbulb, tone: 'sky' },
  focus: { icon: Focus, tone: 'amber' },
};
function InsightCard({
  finding,
  data,
  refresh,
}: {
  finding: Finding;
  data: InsightStatus;
  refresh: () => void;
}) {
  const { icon, tone } = findingTiles[finding.kind];
  const topics = [
    ...new Map(
      data.observations
        .filter((o) => finding.evidenceIds.includes(o.id))
        .flatMap((o) => o.topics ?? [])
        .map((topic) => [topic.toLowerCase(), topic]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b));
  const topicBadges = (list: string[]) =>
    list.map((topic) => (
      <ToneBadge tone="muted" wrap key={topic}>
        {topic}
      </ToneBadge>
    ));
  return (
    <SidePanel>
      <SidePanelTrigger asChild>
        <Tile aria-label={`Inspect insight: ${finding.title}`}>
          <span className="flex items-center justify-between gap-3">
            <IconTile icon={icon} tone={tone} />
            <ToneBadge>{findingLabels[finding.kind]}</ToneBadge>
          </span>
          <TileTitle>{finding.title}</TileTitle>
          {topics.length > 0 && (
            <span
              className="flex flex-wrap items-center gap-1.5"
              aria-label="Topics from supporting questions"
            >
              {topicBadges(topics.slice(0, 3))}
              {topics.length > 3 && (
                <span className="text-xs text-muted-foreground">+{topics.length - 3} more</span>
              )}
            </span>
          )}
          <Callout label="Next time" className="mt-auto">
            {finding.action}
          </Callout>
        </Tile>
      </SidePanelTrigger>
      <SidePanelContent
        closeLabel="Close insight"
        eyebrow={
          <span className="flex items-center gap-2.5">
            <IconTile icon={icon} tone={tone} size="sm" />
            <ToneBadge>{findingLabels[finding.kind]}</ToneBadge>
          </span>
        }
      >
        <SidePanelTitle className="mt-1">{finding.title}</SidePanelTitle>
        {topics.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5"
            aria-label="Topics from supporting questions"
          >
            <span className="mr-1 text-xs text-muted-foreground">Topics</span>
            {topicBadges(topics)}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Subheading>Why</Subheading>
          <SidePanelDescription className="text-[0.9375rem] leading-relaxed">
            {finding.explanation}
          </SidePanelDescription>
        </div>
        <Callout tone="brand" label="Next time">
          {finding.action}
        </Callout>
        {finding.caveat && <p className="text-xs text-muted-foreground">{finding.caveat}</p>}
        <Disclosure quiet title={`Inspect evidence (${finding.evidenceIds.length})`}>
          <List>
            {finding.evidenceIds.map((id) => {
              const observation = data.observations.find((o) => o.id === id);
              return observation ? (
                <Evidence key={id} observation={observation} onDismiss={refresh} />
              ) : null;
            })}
          </List>
        </Disclosure>
        {finding.suggestions.length > 0 && (
          <section className="flex flex-col gap-1">
            <SectionHeader level={3} icon={BookOpen} title="Optional targeted practice" />
            <List>
              {finding.suggestions.map((s) => {
                const problem = data.suggestions.find((p) => p.id === s.problemId);
                return problem ? (
                  <ListRow
                    key={s.problemId}
                    title={problem.title}
                    to={`/library/${s.problemId}`}
                    meta={s.reason}
                  />
                ) : null;
              })}
            </List>
          </section>
        )}
      </SidePanelContent>
    </SidePanel>
  );
}

function StatusPanel({
  data,
  mountId,
  action,
}: {
  data: InsightStatus;
  mountId: string;
  action: ReturnType<typeof useInsightAction>;
}) {
  const progress = data.total
    ? Math.min(100, Math.max(0, Math.floor((data.analyzed / data.total) * 100)))
    : 0;
  return (
    <Panel className="shrink-0 gap-4 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-8">
      <div className="flex min-w-0 items-start gap-4">
        <IconTile icon={Sparkles} tone="brand" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {!data.enabled ? (
            <>
              <p className="pt-2 leading-6 font-medium">
                {data.report
                  ? 'Automatic analysis is off. Your saved report is still available below.'
                  : 'Connect lessons across your saved attempts, with evidence you can inspect and correct.'}
              </p>
              <p className="text-muted-foreground">
                {data.report
                  ? 'Turn it on to analyze new completed attempts and updated reflections automatically.'
                  : 'Enabling downloads a small search model to your computer. Your connected MCP tutor analyzes saved code and reflections through its model provider. All completed history is processed, then new attempts update automatically.'}
              </p>
            </>
          ) : (
            <>
              <p className="flex min-h-10 items-baseline gap-1.5 tabular-nums">
                <strong className="text-[1.75rem] leading-none font-semibold tracking-[-0.035em]">
                  {data.analyzed}
                </strong>
                <span className="text-muted-foreground">of {data.total} attempts analyzed</span>
              </p>
              {data.total > 0 && (
                <div className="flex items-center gap-3">
                  <Meter
                    label="Attempts analyzed"
                    valueText={`${data.analyzed} of ${data.total} attempts analyzed`}
                    max={data.total}
                    value={data.analyzed}
                  />
                  <span className="min-w-[3ch] text-right text-xs text-muted-foreground tabular-nums">
                    {progress}%
                  </span>
                </div>
              )}
              <AnalysisStatus data={data} />
              {data.total === 0 && (
                <p className="text-muted-foreground">
                  Save a completed attempt to start building your learning memory.
                </p>
              )}
              {(data.failed > 0 || data.embeddingStatus === 'failed') && (
                <div role="alert">
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ path: 'retry', body: {} })}
                  >
                    Retry analysis
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-6 border-t pt-4 md:min-w-68 md:self-stretch md:border-t-0 md:border-l md:py-1 md:pl-8">
        <div>
          <label htmlFor={`${mountId}-automatic`} className="cursor-pointer font-medium">
            Automatic analysis
          </label>
          <p id={`${mountId}-automatic-description`} className="mt-1 text-xs text-muted-foreground">
            {data.enabled
              ? 'Analyze new attempts and updated reflections.'
              : 'Off — saved insights are kept.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {action.isPending ? 'Saving…' : data.enabled ? 'On' : 'Off'}
          </span>
          <Switch
            id={`${mountId}-automatic`}
            aria-describedby={`${mountId}-automatic-description`}
            checked={data.enabled}
            disabled={action.isPending}
            onCheckedChange={(enabled) => action.mutate({ path: 'enable', body: { enabled } })}
          />
        </div>
      </div>
      {action.isError && (
        <div className="md:col-span-2">
          <ErrorNotice error={action.error} />
        </div>
      )}
    </Panel>
  );
}

function useInsightAction(refresh: () => void) {
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: object }) =>
      api.send(`/insights/${path}`, 'POST', body),
    onSuccess: refresh,
  });
}

export function LearningInsights() {
  const mountId = useId(),
    cache = useQueryClient();
  const query = useQuery({
    queryKey: ['learning-insights', mountId],
    queryFn: () => api.get<InsightStatus>('/insights'),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['learning-insights'] });
  };
  const action = useInsightAction(refresh);
  const data = query.data;
  const findings = data?.report?.findings ?? [];
  return (
    <>
      <PageHeader
        title="Learning insights"
        description="Pick one habit to practise on your next problem."
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : data?.hidden ? (
        <Panel>
          <EmptyState
            icon={Lock}
            title="Insights unlock after your assessment"
            description="Finish your mixed assessment to see learning patterns and practice suggestions."
          />
        </Panel>
      ) : (
        data && (
          <FillPage>
            <StatusPanel data={data} mountId={mountId} action={action} />
            {data.report ? (
              <section className="flex min-h-0 flex-1 flex-col gap-3">
                <SectionHeader
                  className="mt-2"
                  title="Try on your next attempt"
                  meta={
                    findings.length > 0 &&
                    `${findings.length} ${findings.length === 1 ? 'habit' : 'habits'}`
                  }
                />
                {data.stale && (
                  <p className="-mt-1 text-xs text-muted-foreground">
                    Updating your report. These actions are from the previous report.
                  </p>
                )}
                <ScrollRegion className="flex flex-col gap-2">
                  {findings.length ? (
                    <TileGrid>
                      {findings.map((finding) => (
                        <InsightCard
                          key={`${data.report!.id}-${finding.title}-${finding.evidenceIds.join(',')}`}
                          finding={finding}
                          data={data}
                          refresh={refresh}
                        />
                      ))}
                    </TileGrid>
                  ) : (
                    <Panel>
                      <EmptyState
                        icon={Lightbulb}
                        title="No patterns to show yet"
                        description="More attempts or detailed reflections may provide useful evidence."
                      />
                    </Panel>
                  )}
                  <div>
                    <Disclosure quiet title="About this report">
                      <div className="flex flex-col gap-2 pb-2 text-[0.8125rem] text-muted-foreground">
                        <p>
                          Updated {new Date(data.report.createdAt).toLocaleString()} ·{' '}
                          {data.report.analyzed} attempts covered
                        </p>
                        <p>{data.report.limitation}</p>
                        <p>
                          Findings describe saved evidence, not every step you took while solving.
                          Practice suggestions leave your study schedule unchanged.
                        </p>
                      </div>
                    </Disclosure>
                  </div>
                </ScrollRegion>
              </section>
            ) : (
              data.enabled && (
                <Panel>
                  <EmptyState
                    icon={Sparkles}
                    tone="brand"
                    title="Your first report is on its way"
                    description="It appears once your tutor analyzes saved attempts. Keep practising while it works."
                  />
                </Panel>
              )
            )}
          </FillPage>
        )
      )}
    </>
  );
}
