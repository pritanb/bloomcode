import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
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
import { ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import { Panel } from '../../components/kit';
import { Help } from './settings-parts';

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
      <Panel>
        <Loading />
      </Panel>
    );
  if (query.isError)
    return (
      <Panel>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      </Panel>
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
    <Panel title="AI tutor" icon={Bot}>
      <Help>
        Writes tutor reports, learning insights and topic picks. Practice and saving work without
        it.
      </Help>
      <form
        className="flex flex-col gap-4"
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
            <Help>
              The app runs Codex on this Mac for each job, isolated with no tools. Usage counts
              toward your ChatGPT plan limits.
            </Help>
            <Field label="Model">
              <Input
                required
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              />
            </Field>
            <Disclosure quiet title="Advanced">
              <div className="flex flex-col gap-4 pb-1">
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
              </div>
            </Disclosure>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
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
            <p className="text-[0.9375rem] font-semibold" role="status">
              Codex replied in {(test.data.ms / 1000).toFixed(1)} s using {test.data.model}
              {test.data.version ? ` (${test.data.version})` : ''}.
            </p>
          ) : (
            <p className="text-[0.9375rem]" role="alert">
              {test.data.error?.message}
            </p>
          ))}
        {codex && !test.data && status.lastError && (
          <Help role="status">Last problem: {status.lastError.message}</Help>
        )}
      </form>
    </Panel>
  );
}
