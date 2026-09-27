import { Disclosure } from '@/components/disclosure';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { CalendarDays, Database, HardDriveDownload, Palette, RefreshCw, Save } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Settings as SettingsData, Dashboard, DailyPlan } from '../../../shared/contracts';
import {
  defaultRecommendations,
  type RecommendationOptions,
  type RecommendationSettings,
} from '../../../shared/recommendations';
import { api } from '../../app/api';
import { TutorSettings } from './TutorSettings';
import { AccentPicker } from '../../app/theme';
import { Icon, dateLabel, ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import {
  FillPage,
  IconTile,
  PageHeader,
  Panel,
  ScrollRegion,
  ToneBadge,
} from '../../components/kit';
import { Help, SettingsGroup } from './settings-parts';

export function Settings() {
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return (
    <>
      <PageHeader
        title="Settings & data"
        description="A workload that fits your day, with your records backed up."
      />
      <SettingsForm settings={query.data} />
    </>
  );
}
function SettingsForm({ settings }: { settings: SettingsData }) {
  const [questions, setQuestions] = useState(
    settings.questionsPerDay ?? settings.primaryCount + settings.optionalCount,
  );
  const [recommendations, setRecommendations] = useState(
    settings.recommendations ?? defaultRecommendations,
  );
  const [autoScore, setAutoScore] = useState(settings.autoScore ?? true);
  const unsaved =
    questions !== (settings.questionsPerDay ?? settings.primaryCount + settings.optionalCount) ||
    autoScore !== (settings.autoScore ?? true) ||
    JSON.stringify(recommendations) !==
      JSON.stringify(settings.recommendations ?? defaultRecommendations);
  const change = (update: Partial<RecommendationSettings>) =>
    setRecommendations((current) => ({ ...current, ...update }));
  const options = useQuery({
    queryKey: ['recommendation-options', recommendations.listId, recommendations.startTopic],
    queryFn: () =>
      api.get<RecommendationOptions>(
        `/recommendations/options?${new URLSearchParams({ listId: recommendations.listId ?? '', startTopic: recommendations.startTopic ?? '' })}`,
      ),
  });
  const rebuild = useAction(async () => {
    const current = await api.get<Dashboard>('/dashboard');
    if (!current.plan) return api.send<DailyPlan>('/daily-plan/ensure', 'POST', {});
    return api.send<DailyPlan>(`/daily-plans/${current.plan.id}/rebuild`, 'POST', {
      version: current.plan.version,
    });
  });
  const save = useAction(() =>
    api.send<SettingsData>('/settings', 'PATCH', {
      questionsPerDay: questions,
      autoScore,
      recommendations,
    }),
  );

  return (
    <FillPage className="min-[901px]:grid min-[901px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] min-[901px]:grid-rows-[minmax(0,1fr)]">
      <Panel title="Study rhythm" icon={CalendarDays} className="min-h-0">
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ScrollRegion className="flex flex-col divide-y">
            <SettingsGroup title="How many">
              <Field label="Questions per day">
                <Input
                  className="w-24"
                  required
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={questions}
                  onChange={(e) => setQuestions(Number(e.target.value))}
                  aria-describedby="questions-help"
                />
              </Field>
              <Help id="questions-help">
                Up to this many each day, when enough questions are available.
              </Help>
            </SettingsGroup>
            <SettingsGroup title="Which questions">
              <Field label="List">
                <SelectField
                  value={recommendations.listId ?? 'all'}
                  onValueChange={(value) =>
                    change({ listId: value === 'all' ? null : value, startTopic: null })
                  }
                >
                  <SelectOption value="all">All questions</SelectOption>
                  {options.data?.lists.map((list) => (
                    <SelectOption key={list.id} value={list.id}>
                      {list.name}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
              <Field label="Order">
                <SelectField
                  value={recommendations.strategy}
                  onValueChange={(value) =>
                    change({
                      strategy: value as RecommendationSettings['strategy'],
                      ...(value === 'topic' && recommendations.completed === 'legacy'
                        ? { completed: 'exclude' as const }
                        : {}),
                    })
                  }
                >
                  <SelectOption value="balanced">Mix topics</SelectOption>
                  <SelectOption value="topic">One topic at a time</SelectOption>
                </SelectField>
              </Field>
              {recommendations.strategy === 'topic' && (
                <>
                  <Field label="Start from">
                    <SelectField
                      value={recommendations.startTopic ?? 'automatic'}
                      onValueChange={(value) =>
                        change({ startTopic: value === 'automatic' ? null : value })
                      }
                    >
                      <SelectOption value="automatic">First unfinished topic</SelectOption>
                      {options.data?.topics.map((topic) => (
                        <SelectOption key={topic.name} value={topic.name}>
                          {topic.name} ({topic.completed}/{topic.total} completed)
                        </SelectOption>
                      ))}
                    </SelectField>
                  </Field>
                  <p className="flex flex-wrap items-center gap-2 text-[0.9375rem]" role="status">
                    <span className="text-muted-foreground">
                      {unsaved ? 'Next topic' : 'Current topic'}:
                    </span>{' '}
                    <ToneBadge tone="brand" className="text-[0.8125rem]">
                      {options.data?.currentTopic ?? 'No unfinished topic'}
                    </ToneBadge>
                  </p>
                  <Disclosure quiet title="When a topic is finished">
                    <Help>
                      {options.data?.orderDescription} The topic advances only after every question
                      has completion evidence. A saved queue is not a completion. Imported
                      completions and recorded solves count, and a later retry does not erase them.
                      Snoozed questions wait for their review date.
                    </Help>
                  </Disclosure>
                </>
              )}
              <Field label="Completed questions">
                <SelectField
                  value={recommendations.completed}
                  onValueChange={(value) =>
                    change({ completed: value as RecommendationSettings['completed'] })
                  }
                >
                  <SelectOption value="legacy">No extra limit</SelectOption>
                  <SelectOption value="exclude">Leave them out</SelectOption>
                  <SelectOption value="refreshers">Allow a few refreshers</SelectOption>
                </SelectField>
              </Field>
              {recommendations.completed === 'refreshers' && (
                <>
                  <Field label="Refresher slots per day">
                    <Input
                      className="w-24"
                      type="number"
                      min="0"
                      max="20"
                      step="1"
                      required
                      value={recommendations.refresherSlots}
                      onChange={(e) => change({ refresherSlots: Number(e.target.value) })}
                    />
                  </Field>
                  <Help>
                    These count toward the daily total and can revisit earlier topics within your
                    list. Blind 75 / NeetCode 150 questions are preferred as a curated core, not a
                    popularity rating. Manual review dates and “no review” choices still apply.
                  </Help>
                </>
              )}
              <ErrorNotice error={options.error} retry={() => void options.refetch()} />
            </SettingsGroup>
            <SettingsGroup title="Scores">
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="auto-score"
                  className="mt-0.5"
                  checked={autoScore}
                  onCheckedChange={(value) => setAutoScore(value === true)}
                />
                <label
                  htmlFor="auto-score"
                  className="cursor-pointer text-[0.9375rem] leading-snug"
                >
                  Update topic scores when an attempt finishes
                </label>
              </div>
              <Disclosure quiet title="How scores move">
                <Help>
                  Independent unseen solves can raise a score towards 5. Every other result is
                  capped at 3, and misses on known material lower it slightly. Scores never change
                  without a recorded decision, and a manual review can still override any movement.
                </Help>
              </Disclosure>
            </SettingsGroup>
          </ScrollRegion>
          <ErrorNotice error={save.error} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
            <Button variant="default" disabled={save.isPending}>
              <Icon icon={Save} />
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            {save.isSuccess && (
              <span className="text-[0.9375rem] font-semibold" role="status">
                Settings saved.
              </span>
            )}
            <Help className="min-w-0 flex-1 basis-48">
              Saved for the next plan. Today’s plan stays until you rebuild it.
            </Help>
          </div>
        </form>
      </Panel>
      <ScrollRegion className="flex flex-col gap-4">
        <Panel title="Today’s plan" icon={RefreshCw}>
          <Help>
            Rebuilds only unstarted questions in today’s plan. In-progress drafts, finished and
            skipped items stay, even outside the selected list. Saved attempts, scores and manual
            review choices are never changed.
          </Help>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={unsaved || rebuild.isPending || save.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending ? 'Rebuilding…' : 'Rebuild today’s plan'}
            </Button>
            {unsaved && <p className="text-[0.8125rem] text-muted-foreground">Save first.</p>}
          </div>
          <ErrorNotice error={rebuild.error} />
          {rebuild.isSuccess && (
            <p className="text-[0.9375rem] font-semibold" role="status">
              Today’s plan now uses your saved settings.
            </p>
          )}
        </Panel>
        <Panel title="Appearance" icon={Palette} tone="brand">
          <Help>Accent colour for buttons, highlights and charts. Saved on this device.</Help>
          <AccentPicker />
        </Panel>
        <TutorSettings />
        <Panel title="Your data" icon={Database}>
          <div className="flex items-center gap-3.5 rounded-2xl bg-muted px-4 py-3.5">
            <IconTile icon={HardDriveDownload} className="bg-card" />
            <dl className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[0.8125rem] text-muted-foreground">Last backup</dt>
              <dd className="text-[0.9375rem] font-semibold tabular-nums">
                {settings.lastBackupAt ? dateLabel(settings.lastBackupAt) : 'No backup recorded'}
              </dd>
            </dl>
          </div>
          <Help>
            The app backs up your data automatically once a day and keeps the last seven copies.
          </Help>
        </Panel>
      </ScrollRegion>
    </FillPage>
  );
}
