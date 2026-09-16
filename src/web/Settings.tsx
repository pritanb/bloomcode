import { Disclosure } from '@/components/disclosure';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CalendarDays, Database, Download, Save } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Settings as SettingsData, Snapshot } from '../shared/contracts';
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
  const save = useAction(() =>
    api.send<SettingsData>('/settings', 'PATCH', {
      timezone,
      questionsPerDay: questions,
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
          <p className="small muted">
            Applies to your next daily plan. Your current plan and unfinished work stay unchanged.
          </p>
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
          This app never writes to your source spreadsheet. Import and
          source-of-truth cutover require a separate, approved operation.
        </p>
      </Card>
    </div>
  );
}
