import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { api } from './api';
import { CodeXml } from 'lucide-react';
import { ErrorNotice, Field, Icon, Loading, PageTitle, useAction } from './ui';

export function SetupGate({
  children,
  chrome,
}: {
  children: ReactNode;
  chrome?: (hasWorkspace: boolean) => ReactNode;
}) {
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api.get<{ required: boolean; demo?: boolean }>('/setup'),
  });
  if (setup.isPending)
    return (
      <>
        {chrome?.(false)}
        <Loading />
      </>
    );
  if (setup.isError)
    return (
      <>
        {chrome?.(false)}
        <ErrorNotice error={setup.error} retry={() => void setup.refetch()} />
      </>
    );
  return (
    <>
      {chrome?.(!setup.data.required)}
      {setup.data.required ? (
        <Welcome />
      ) : (
        <>
          {setup.data.demo && (
            <div className="demo-banner" role="status">
              <strong>Demo workspace</strong> · Sample data. Changes are discarded when the demo
              stops.
            </div>
          )}
          {children}
        </>
      )}
    </>
  );
}

function Welcome() {
  // The study day follows this computer's timezone.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [questionsPerDay, setQuestions] = useState(2);
  const [list, setList] = useState('Blind 75');
  const setup = useAction(() => api.send('/setup', 'POST', { timezone, questionsPerDay, list }));
  return (
    <main id="main" className="welcome">
      <PageTitle
        title="Make room for practice"
        description="Set up your own study workspace. Your progress stays on this computer."
      >
        <span className="welcome-mark" aria-hidden="true">
          <Icon icon={CodeXml} />
        </span>
      </PageTitle>
      <Card className="panel">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            setup.mutate();
          }}
        >
          <div className="welcome-fields">
            <Field label="Questions per day">
              <Input
                type="number"
                min="1"
                max="20"
                step="1"
                required
                value={questionsPerDay}
                onChange={(event) => setQuestions(Number(event.target.value))}
              />
            </Field>
          </div>
          <Field label="Start with">
            <SelectField value={list} onValueChange={setList}>
              <SelectOption value="Blind 75">Blind 75 · 75 questions</SelectOption>
              <SelectOption value="NeetCode 150">NeetCode 150 · 150 questions</SelectOption>
              <SelectOption value="NeetCode 250">NeetCode 250 · 250 questions</SelectOption>
              <SelectOption value="none">Empty library · add or import later</SelectOption>
            </SelectField>
          </Field>
          <ul className="welcome-notes">
            <li>
              Starter lists include question links and categories. Solve on LeetCode, then save your
              code, notes and result here.
            </li>
            <li>
              An AI tutor is optional. You can connect one later for feedback; practice and review
              scheduling work on their own.
            </li>
          </ul>
          <ErrorNotice error={setup.error} />
          <Button disabled={setup.isPending}>
            {setup.isPending ? 'Preparing your workspace…' : 'Create my workspace'}
          </Button>
        </form>
        <p className="welcome-footnote">
          Bringing existing progress? Choose an empty library, then use the import or restore
          instructions in the project’s migration guide. You can change your study preferences in
          Settings.
        </p>
      </Card>
    </main>
  );
}
