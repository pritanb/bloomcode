import { Disclosure } from '@/components/disclosure';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CalendarDays, Database, Download, Save } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Settings as SettingsData, Snapshot, Dashboard, DailyPlan } from '../shared/contracts';
import { defaultRecommendations, type RecommendationOptions, type RecommendationSettings } from '../shared/recommendations';
import { api } from './api';
import {
  Icon,
  SectionTitle,
  dateLabel,
  ErrorNotice,
  Field,
  Loading,
  PageTitle,
  useAction,
} from './ui';
export function Settings() {
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
  });
  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
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
  const [timezone, setTimezone] = useState(settings.timezone);
  const [questions, setQuestions] = useState(settings.questionsPerDay ?? settings.primaryCount + settings.optionalCount);
  const [recommendations, setRecommendations] = useState(settings.recommendations ?? defaultRecommendations);
  const [autoScore, setAutoScore] = useState(settings.autoScore ?? true);
  const unsaved=timezone!==settings.timezone||questions!==(settings.questionsPerDay??settings.primaryCount+settings.optionalCount)||autoScore!==(settings.autoScore??true)||JSON.stringify(recommendations)!==JSON.stringify(settings.recommendations??defaultRecommendations);
  const change = (update: Partial<RecommendationSettings>) => setRecommendations(current => ({...current,...update}));
  const options = useQuery({queryKey:['recommendation-options',recommendations.listId,recommendations.startTopic],queryFn:()=>api.get<RecommendationOptions>(`/recommendations/options?${new URLSearchParams({listId:recommendations.listId??'',startTopic:recommendations.startTopic??''})}`)});
  const rebuild = useAction(async () => {
    const current = await api.get<Dashboard>('/dashboard');
    if (!current.plan) return api.send<DailyPlan>('/daily-plan/ensure','POST',{});
    return api.send<DailyPlan>(`/daily-plans/${current.plan.id}/rebuild`,'POST',{version:current.plan.version});
  });
  const save = useAction(() =>
    api.send<SettingsData>('/settings', 'PATCH', {
      timezone,
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
    <div className="settings-grid">
      <Card className="panel">
        <SectionTitle icon={CalendarDays}>Study rhythm</SectionTitle>
        <p className="muted">
          Choose how many questions to do each day.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Questions per day">
            <Input required type="number" min="1" max="20" step="1"
              value={questions} onChange={(e) => setQuestions(Number(e.target.value))}
              aria-describedby="questions-help" />
          </Field>
          <p id="questions-help" className="small muted">
            We’ll plan up to this many questions each day, depending on what’s available.
          </p>
          <Disclosure title="Advanced">
            <Field label="Study timezone">
              <SelectField value={timezone} onValueChange={setTimezone} required>
                {[...new Set([timezone, 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort().map(zone => <SelectOption key={zone} value={zone}>{zone}</SelectOption>)}
              </SelectField>
            </Field>
          </Disclosure>
          <Separator />
          <h3>Daily recommendations</h3>
          <Field label="Recommend only from">
            <SelectField value={recommendations.listId??'all'} onValueChange={value=>change({listId:value==='all'?null:value,startTopic:null})}>
              <SelectOption value="all">All questions</SelectOption>
              {options.data?.lists.map(list=><SelectOption key={list.id} value={list.id}>{list.name}</SelectOption>)}
            </SelectField>
          </Field>
          <p className="small muted">A specific list is a strict limit, including reviews and swaps. If it has too few eligible questions, your plan stays shorter.</p>
          <Field label="Selection strategy">
            <SelectField value={recommendations.strategy} onValueChange={value=>change({strategy:value as RecommendationSettings['strategy'],...(value==='topic'&&recommendations.completed==='legacy'?{completed:'exclude' as const}:{})})}>
              <SelectOption value="balanced">Mixed / balanced</SelectOption>
              <SelectOption value="topic">Topic by topic</SelectOption>
            </SelectField>
          </Field>
          {recommendations.strategy==='topic'&&<>
            <Field label="Start progression from">
              <SelectField value={recommendations.startTopic??'automatic'} onValueChange={value=>change({startTopic:value==='automatic'?null:value})}>
                <SelectOption value="automatic">First unfinished topic</SelectOption>
                {options.data?.topics.map(topic=><SelectOption key={topic.name} value={topic.name}>{topic.name} ({topic.completed}/{topic.total} completed)</SelectOption>)}
              </SelectField>
            </Field>
            <p className="small muted">{options.data?.orderDescription} Advance only when every question in the current topic has completion evidence. A saved queue is not a completion.</p>
            <p role="status">{unsaved?'Preview current topic':'Current topic'}: <strong>{options.data?.currentTopic??'No unfinished topic in this progression'}</strong></p>
            <p className="small muted">Existing imported completions and any recorded solved attempt count. A later retry never erases them. Snoozed questions wait for their review date.</p>
          </>}
          <Field label="Previously completed questions">
            <SelectField value={recommendations.completed} onValueChange={value=>change({completed:value as RecommendationSettings['completed']})}>
              <SelectOption value="legacy">Include as before (no separate limit)</SelectOption>
              <SelectOption value="exclude">Exclude completed questions</SelectOption>
              <SelectOption value="refreshers">Include limited refreshers</SelectOption>
            </SelectField>
          </Field>
          {recommendations.completed==='refreshers'&&<>
            <Field label="Maximum refresher slots per day"><Input type="number" min="0" max="20" step="1" required value={recommendations.refresherSlots} onChange={e=>change({refresherSlots:Number(e.target.value)})}/></Field>
            <p className="small muted">Included in your daily question count. Refreshers can revisit earlier topics within your chosen list. Blind 75 / NeetCode 150 membership is preferred as a curated core—not a popularity rating. Manual review dates and “no review” choices still apply.</p>
          </>}
          <ErrorNotice error={options.error} retry={()=>void options.refetch()} />
          <p className="small muted">
            Applies to your next daily plan. Your current plan and unfinished work stay unchanged.
          </p>
          <Separator />
          <h3>Topic scores</h3>
          <div className="row">
            <Checkbox id="auto-score" checked={autoScore} onCheckedChange={value=>setAutoScore(value===true)} />
            <label htmlFor="auto-score">Move topic scores automatically when an attempt finishes</label>
          </div>
          <p className="small muted">Conservative rules: independent unseen solves can raise a score towards 5; every other result is capped at 3, and misses on known material lower it slightly. Scores never change without a recorded decision, and a manual review can still override any movement.</p>
          <ErrorNotice error={save.error} />
          <div className="row">
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
        <Separator />
        <h3>Apply saved settings today</h3>
        <p className="small muted">Rebuild only unstarted assignments in your current plan. Active drafts, completed and skipped items stay—even outside the selected list. Saved attempts, scores and manual review choices are never changed. Save settings first.</p>
        <Button variant="outline" disabled={unsaved||rebuild.isPending||save.isPending} onClick={()=>rebuild.mutate()}>{rebuild.isPending?'Rebuilding…':'Rebuild unstarted current plan'}</Button>
        {unsaved&&<p className="small muted">Save your changes to enable rebuilding.</p>}
        <ErrorNotice error={rebuild.error} />
        {rebuild.isSuccess&&<p className="positive" role="status">Current plan rebuilt using saved settings.</p>}
      </Card>
      <Card className="panel">
        <SectionTitle icon={Database}>Your data</SectionTitle>
        <dl className="data-status">
          <div>
            <dt>Current workspace</dt>
            <dd>{settings.dataMode}</dd>
          </div>
          <div>
            <dt>Last backup</dt>
            <dd>
              {settings.lastBackupAt
                ? dateLabel(settings.lastBackupAt)
                : 'No backup recorded'}
            </dd>
          </div>
        </dl>
        <h3>Portable export</h3>
        <p>
          Download questions, answers, notes, lists, review dates and score
          history as JSON. Keep this file private: it contains your study
          records.
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
        <Separator />
        <h3>Backup & restore</h3>
        <p>
          Local database backups and restore use the authenticated command-line
          tools. Restore is only allowed into an empty database.
        </p>
        <p className="small muted">
          See the project’s operations guide for the verified commands. Browser
          sessions cannot access the administrative token.
        </p>
        <Separator />
        <h3>Migration stays explicit</h3>
        <p className="small muted">
          This app never writes to your source spreadsheet. The spreadsheet is
          a read-only archive; this app is the authoritative record.
        </p>
      </Card>
    </div>
  );
}
