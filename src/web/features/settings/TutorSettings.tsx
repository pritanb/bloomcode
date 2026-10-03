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

const providers = {
  codex: {
    label: 'Codex',
    plan: 'ChatGPT',
    path: 'codexPath',
    model: 'model',
  },
  claude: {
    label: 'Claude Code',
    plan: 'Claude',
    path: 'claudePath',
    model: 'claudeModel',
  },
} as const;

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
  const settings: Settings = {
    ...draft,
    codexPath: draft.codexPath?.trim() || null,
    claudePath: draft.claudePath?.trim() || null,
  };
  const unsaved = JSON.stringify(settings) !== JSON.stringify(saved);
  const save = useAction(() => api.send('/tutor/settings', 'POST', settings));
  const test = useAction(() => api.send<TutorTestResult>('/tutor/test', 'POST', settings));
  const cli = draft.provider === 'off' ? null : providers[draft.provider];
  // The runner status describes the saved provider, so only show it while that one is selected.
  const current = draft.provider === saved.provider;
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
            onValueChange={(provider) => {
              test.reset(); // a result belongs to the provider it tested
              setDraft({ ...draft, provider: provider as Settings['provider'] });
            }}
          >
            <SelectOption value="codex">Codex (your ChatGPT plan)</SelectOption>
            <SelectOption value="claude">Claude Code (your Claude plan)</SelectOption>
            <SelectOption value="off">Off</SelectOption>
          </SelectField>
        </Field>
        {cli && (
          <>
            <Help>
              The app runs {cli.label} on this Mac for each job, isolated with no tools. Usage
              counts toward your {cli.plan} plan limits.
            </Help>
            <Field label="Model">
              <Input
                required
                value={draft[cli.model]}
                onChange={(e) => setDraft({ ...draft, [cli.model]: e.target.value })}
              />
            </Field>
            <Disclosure quiet title="Advanced">
              <div className="flex flex-col gap-4 pb-1">
                <Field label={`${cli.label} path`}>
                  <Input
                    value={draft[cli.path] ?? ''}
                    placeholder={(current && status.cliPath) || 'Detected automatically'}
                    onChange={(e) => setDraft({ ...draft, [cli.path]: e.target.value })}
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
          {cli && (
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? 'Testing…' : `Test ${cli.label}`}
            </Button>
          )}
        </div>
        <ErrorNotice error={save.error ?? test.error} />
        {test.data &&
          (test.data.ok ? (
            <p className="text-[0.9375rem] font-semibold" role="status">
              {cli?.label} replied in {(test.data.ms / 1000).toFixed(1)} s using {test.data.model}
              {test.data.version ? ` (${test.data.version})` : ''}.
            </p>
          ) : (
            <p className="text-[0.9375rem]" role="alert">
              {test.data.error?.message}
            </p>
          ))}
        {cli && current && !test.data && status.lastError && (
          <Help role="status">Last problem: {status.lastError.message}</Help>
        )}
      </form>
    </Panel>
  );
}
