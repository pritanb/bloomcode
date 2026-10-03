import { Disclosure } from '@/components/disclosure';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CalendarDays, Database, HardDriveDownload, Palette, RefreshCw, Save } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Settings as SettingsData, Dashboard, DailyPlan } from '../../../shared/contracts';
import { defaultRecommendations } from '../../../shared/recommendations';
import { api } from '../../app/api';
import { TutorSettings } from './TutorSettings';
import { AccentPicker } from '../../app/theme';
import { Icon, dateLabel, ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import { FillPage, IconTile, PageHeader, Panel, ScrollRegion } from '../../components/kit';
import { Help, SettingsGroup } from './settings-parts';

type BankStatus = {
  state: 'idle' | 'running' | 'done' | 'failed';
  message: string | null;
  problems: number;
  method: string | null;
  fittedAt: string | null;
};
function ProblemBank() {
  const status = useQuery({
    queryKey: ['problem-bank'],
    queryFn: () => api.get<BankStatus>('/problem-bank'),
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 2000 : false),
  });
  const refresh = useAction(() => api.send<BankStatus>('/problem-bank/refresh', 'POST', {}));
  const data = status.data;
  const running = data?.state === 'running' || refresh.isPending;
  return (
    <div className="flex flex-col gap-2" role="status">
      <p className="text-[0.9375rem]">
        {data?.problems
          ? `Problem bank: ${data.problems.toLocaleString()} problems rated up to 2,000.`
          : 'No problem bank yet. Download it so Bloom can pick questions at your level.'}
      </p>
      {data?.message && <Help>{data.message}</Help>}
      {data?.fittedAt && !running && (
        <Help>
          Ratings updated {dateLabel(data.fittedAt.slice(0, 10))}. Contest problems use their real
          rating; others are estimated from difficulty, acceptance rate and topics (about ±150).
        </Help>
      )}
      <div>
        <Button type="button" variant="outline" disabled={running} onClick={() => refresh.mutate()}>
          <RefreshCw aria-hidden="true" className={running ? 'motion-safe:animate-spin' : ''} />
          {running
            ? 'Updating…'
            : data?.problems
              ? 'Refresh problem bank'
              : 'Download problem bank'}
        </Button>
      </div>
      <ErrorNotice error={status.error ?? refresh.error} />
    </div>
  );
}

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
              <Field label="Target rating">
                <Input
                  className="w-28"
                  required
                  type="number"
                  min="1200"
                  max="2600"
                  step="50"
                  value={recommendations.targetRating}
                  onChange={(e) => setRecommendations({ targetRating: Number(e.target.value) })}
                  aria-describedby="target-help"
                />
              </Field>
              <Help id="target-help">
                Bloom trains each topic up to this problem rating, then keeps it fresh with reviews.
                1,850 covers most Mediums asked in FAANG screens; Hards usually start around 2,100.
                Questions come from the LeetCode problem bank, not from lists.
              </Help>
              <ProblemBank />
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
            Plans today’s unstarted questions again: Bloom re-plans them when the tutor is on,
            otherwise the built-in rules do. In-progress drafts, finished and skipped items stay.
            Saved attempts, scores and review choices are never changed.
          </Help>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={unsaved || rebuild.isPending || save.isPending}
              onClick={() => rebuild.mutate()}
            >
              {rebuild.isPending ? 'Re-planning…' : 'Re-plan today'}
            </Button>
            {unsaved && <p className="text-[0.8125rem] text-muted-foreground">Save first.</p>}
          </div>
          <ErrorNotice error={rebuild.error} />
          {rebuild.isSuccess && (
            <p className="text-[0.9375rem] font-semibold" role="status">
              Today’s plan is being re-planned with your saved settings.
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
