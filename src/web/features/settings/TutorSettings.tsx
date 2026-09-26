import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Disclosure } from '@/components/disclosure';
import { SelectField, SelectOption } from '@/components/select-field';
import {
  TUTOR_EFFORTS,
  TUTOR_JOB_KINDS,
  type TutorJobKind,
  type TutorRunnerStatus,
  type TutorSettings as Settings,
  type TutorTestResult,
} from '../../../shared/tutor';
import { api } from '../../app/api';
import { ErrorNotice, Field, Loading, SectionTitle, useAction } from '../../components/ui';

const jobLabels: Record<TutorJobKind, string> = {
  review: 'Tutor report',
  extraction: 'Attempt analysis',
  report: 'Learning report',
  topics: 'Topic picks',
};

export function TutorSettings() {
  const query = useQuery({
    queryKey: ['tutor'],
    queryFn: () => api.get<{ settings: Settings; status: TutorRunnerStatus }>('/tutor'),
  });
  if (query.isPending)
    return (
      <Card className="panel">
        <Loading />
      </Card>
    );
  if (query.isError)
    return (
      <Card className="panel">
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      </Card>
    );
  return <TutorForm saved={query.data.settings} status={query.data.status} />;
}

function TutorForm({ saved, status }: { saved: Settings; status: TutorRunnerStatus }) {
  const [draft, setDraft] = useState(saved);
  const [path, setPath] = useState(saved.codexPath ?? '');
  const settings: Settings = { ...draft, codexPath: path.trim() || null };
  const unsaved = JSON.stringify(settings) !== JSON.stringify(saved);
  const save = useAction(() => api.send('/tutor/settings', 'POST', settings));
  const test = useAction(() => api.send<TutorTestResult>('/tutor/test', 'POST', settings));
  const codex = draft.provider === 'codex';
  return (
    <Card className="panel tutor-settings">
      <SectionTitle icon={Bot}>AI tutor</SectionTitle>
      <p className="settings-help">
        Writes tutor reports, learning insights and topic picks. Practice and saving work without
        it.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Run the tutor with">
          <SelectField
            value={draft.provider}
            onValueChange={(provider) =>
              setDraft({ ...draft, provider: provider as Settings['provider'] })
            }
          >
            <SelectOption value="codex">Codex (your ChatGPT plan)</SelectOption>
            <SelectOption value="off">Off</SelectOption>
          </SelectField>
        </Field>
        {codex && (
          <>
            <p className="settings-help">
              The app runs Codex on this Mac for each job, isolated with no tools. Usage counts
              toward your ChatGPT plan limits.
            </p>
            <Field label="Model">
              <Input
                required
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </Field>
            <Disclosure title="Advanced">
              <Field label="Codex path">
                <Input
                  value={path}
                  placeholder={status.codexPath ?? 'Detected automatically'}
                  onChange={(e) => setPath(e.target.value)}
                />
              </Field>
              {TUTOR_JOB_KINDS.map((kind) => (
                <Field key={kind} label={`${jobLabels[kind]} reasoning`}>
                  <SelectField
                    value={draft.effort[kind]}
                    onValueChange={(effort) =>
                      setDraft({ ...draft, effort: { ...draft.effort, [kind]: effort } })
                    }
                  >
                    {TUTOR_EFFORTS.map((effort) => (
                      <SelectOption key={effort} value={effort}>
                        {effort}
                      </SelectOption>
                    ))}
                  </SelectField>
                </Field>
              ))}
            </Disclosure>
          </>
        )}
        <div className="row">
          <Button type="submit" disabled={!unsaved || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save tutor settings'}
          </Button>
          {codex && (
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? 'Testing…' : 'Test Codex'}
            </Button>
          )}
        </div>
        <ErrorNotice error={save.error ?? test.error} />
        {test.data &&
          (test.data.ok ? (
            <p className="positive" role="status">
              Codex replied in {(test.data.ms / 1000).toFixed(1)} s using {test.data.model}
              {test.data.version ? ` (${test.data.version})` : ''}.
            </p>
          ) : (
            <p role="alert">{test.data.error?.message}</p>
          ))}
        {codex && !test.data && status.lastError && (
          <p className="small muted" role="status">
            Last problem: {status.lastError.message}
          </p>
        )}
      </form>
    </Card>
  );
}
