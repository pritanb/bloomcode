import { Disclosure } from '@/components/disclosure';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { CalendarDays, Database, Download, Palette, Save } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Settings as SettingsData,
  Snapshot,
  Dashboard,
  DailyPlan,
} from '../../../shared/contracts';
import {
  defaultRecommendations,
  type RecommendationOptions,
  type RecommendationSettings,
} from '../../../shared/recommendations';
import { api } from '../../app/api';
import { TutorSettings } from './TutorSettings';
import { AccentPicker } from '../../app/theme';
import {
  Icon,
  SectionTitle,
  dateLabel,
  ErrorNotice,
  Field,
  Loading,
  PageTitle,
  useAction,
} from '../../components/ui';
export function Settings() {
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return (
    <>
      <PageTitle
        title="Settings & data"
        description="A workload that fits your day. Records you can take with you."
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
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [exported, setExported] = useState(false);
  async function download() {
    setExporting(true);
    setError(null);
    try {
      const snapshot = await api.get<Snapshot>('/export');
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leetcode-tutor-${snapshot.exportedAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExported(true);
    } catch (e) {
      setError(e);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="settings-grid fill-page">
      <Card className="panel settings-main">
        <SectionTitle icon={CalendarDays}>Study rhythm</SectionTitle>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <section className="settings-group">
            <h3>How many</h3>
            <Field label="Questions per day">
              <Input
                className="settings-number"
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
            <p id="questions-help" className="settings-help">
              Up to this many each day, when enough questions are available.
            </p>
          </section>
          <section className="settings-group">
            <h3>Which questions</h3>
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
            <p className="settings-help">
              A list is a hard limit, including reviews and swaps. A short list makes a shorter
              plan.
            </p>
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
                <p className="settings-current" role="status">
                  {unsaved ? 'Next topic' : 'Current topic'}:{' '}
                  <strong>{options.data?.currentTopic ?? 'No unfinished topic'}</strong>
                </p>
                <div className="settings-more">
                  <Disclosure title="When a topic is finished">
                    <p className="settings-help">
                      {options.data?.orderDescription} The topic advances only after every question
                      has completion evidence. A saved queue is not a completion. Imported
                      completions and recorded solves count, and a later retry does not erase them.
                      Snoozed questions wait for their review date.
                    </p>
                  </Disclosure>
                </div>
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
                    className="settings-number"
                    type="number"
                    min="0"
                    max="20"
                    step="1"
                    required
                    value={recommendations.refresherSlots}
                    onChange={(e) => change({ refresherSlots: Number(e.target.value) })}
                  />
                </Field>
                <p className="settings-help">
                  These count toward the daily total and can revisit earlier topics within your
                  list. Blind 75 / NeetCode 150 questions are preferred as a curated core, not a
                  popularity rating. Manual review dates and “no review” choices still apply.
                </p>
              </>
            )}
            <ErrorNotice error={options.error} retry={() => void options.refetch()} />
            <p className="settings-note">
              Saved for the next plan. Today’s plan stays until you rebuild it below.
            </p>
          </section>
          <section className="settings-group">
            <h3>Scores</h3>
            <div className="settings-check">
              <Checkbox
                id="auto-score"
                checked={autoScore}
                onCheckedChange={(value) => setAutoScore(value === true)}
              />
              <label htmlFor="auto-score">Update topic scores when an attempt finishes</label>
            </div>
            <div className="settings-more">
              <Disclosure title="How scores move">
                <p className="settings-help">
                  Independent unseen solves can raise a score towards 5. Every other result is
                  capped at 3, and misses on known material lower it slightly. Scores never change
                  without a recorded decision, and a manual review can still override any movement.
                </p>
              </Disclosure>
            </div>
          </section>
          <ErrorNotice error={save.error} />
          <div className="settings-actions">
            <Button variant="default" disabled={save.isPending}>
              <Icon icon={Save} />
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            {save.isSuccess && (
              <span className="positive" role="status">
                Settings saved.
              </span>
            )}
          </div>
        </form>
        <section className="settings-callout">
          <h3>Today’s plan</h3>
          <p className="settings-help">
            Rebuilds only unstarted questions in today’s plan. In-progress drafts, finished and
            skipped items stay, even outside the selected list. Saved attempts, scores and manual
            review choices are never changed.
          </p>
          <Button
            variant="outline"
            disabled={unsaved || rebuild.isPending || save.isPending}
            onClick={() => rebuild.mutate()}
          >
            {rebuild.isPending ? 'Rebuilding…' : 'Rebuild today’s plan'}
          </Button>
          {unsaved && <p className="small muted">Save first.</p>}
          <ErrorNotice error={rebuild.error} />
          {rebuild.isSuccess && (
            <p className="positive" role="status">
              Today’s plan now uses your saved settings.
            </p>
          )}
        </section>
      </Card>
      <div className="settings-side">
        <Card className="panel">
          <SectionTitle icon={Palette}>Appearance</SectionTitle>
          <p className="settings-help">
            Accent colour for buttons, highlights and charts. Saved on this device.
          </p>
          <AccentPicker />
        </Card>
        <TutorSettings />
        <Card className="panel settings-data">
          <SectionTitle icon={Database}>Your data</SectionTitle>
          <dl className="data-status">
            <div>
              <dt>Current workspace</dt>
              <dd>{settings.dataMode}</dd>
            </div>
            <div>
              <dt>Last backup</dt>
              <dd>
                {settings.lastBackupAt ? dateLabel(settings.lastBackupAt) : 'No backup recorded'}
              </dd>
            </div>
          </dl>
          <section className="settings-group">
            <h3>Portable export</h3>
            <p className="settings-help">
              Download questions, answers, notes, lists, review dates and score history as JSON.
            </p>
            <p className="settings-caveat">
              Keep this file private: it contains your study records.
            </p>
            <Button variant="outline" disabled={exporting} onClick={() => void download()}>
              <Icon icon={Download} />
              {exporting ? 'Preparing export…' : 'Download export'}
            </Button>
            {exported && (
              <p className="positive" role="status">
                Export prepared for download.
              </p>
            )}
            <ErrorNotice error={error} retry={() => void download()} />
          </section>
          <section className="settings-group">
            <h3>Backup & restore</h3>
            <p className="settings-caveat">
              Local database backups and restore use the authenticated command-line tools. Restore
              is only allowed into an empty database.
            </p>
            <p className="settings-help">
              See the project’s operations guide for the verified commands. Browser sessions cannot
              access the administrative token.
            </p>
          </section>
          <section className="settings-group">
            <h3>Migration stays explicit</h3>
            <p className="settings-caveat">
              This app never writes to your source spreadsheet. The spreadsheet is a read-only
              archive; this app is the authoritative record.
            </p>
          </section>
        </Card>
      </div>
    </div>
  );
}
