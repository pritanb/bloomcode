import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { api } from '../../app/api';
import { Bot, CodeXml, ListChecks } from 'lucide-react';
import { ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import { IconTile, Panel } from '../../components/kit';

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
            <div
              className="border-b bg-accent px-4 py-2.5 text-center text-[0.875rem] text-accent-foreground"
              role="status"
            >
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
    <main
      id="main"
      className="mx-auto box-border flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10"
    >
      <header className="mb-6 flex flex-col items-start gap-5">
        <IconTile icon={CodeXml} tone="solid" size="lg" />
        <div>
          <h1 className="font-heading text-[1.875rem] leading-tight font-bold tracking-[-0.03em]">
            Make room for practice
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
            Set up your own study workspace. Your progress stays on this computer.
          </p>
        </div>
      </header>
      <Panel className="gap-5 p-7">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setup.mutate();
          }}
        >
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
          <Field label="Start with">
            <SelectField value={list} onValueChange={setList}>
              <SelectOption value="Blind 75">Blind 75 · 75 questions</SelectOption>
              <SelectOption value="NeetCode 150">NeetCode 150 · 150 questions</SelectOption>
              <SelectOption value="NeetCode 250">NeetCode 250 · 250 questions</SelectOption>
              <SelectOption value="none">Empty library · add or import later</SelectOption>
            </SelectField>
          </Field>
          <ul className="m-0 flex list-none flex-col gap-3 rounded-2xl bg-muted p-4 text-[0.875rem] text-muted-foreground">
            <li className="flex items-start gap-3">
              <IconTile icon={ListChecks} size="sm" className="bg-card" />
              <span>
                Starter lists include question links and categories. Solve on LeetCode, then save
                your code, notes and result here.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <IconTile icon={Bot} size="sm" className="bg-card" />
              <span>
                An AI tutor is optional. You can connect one later for feedback; practice and review
                scheduling work on their own.
              </span>
            </li>
          </ul>
          <ErrorNotice error={setup.error} />
          <Button className="h-11 self-stretch text-[0.9375rem]" disabled={setup.isPending}>
            {setup.isPending ? 'Preparing your workspace…' : 'Create my workspace'}
          </Button>
        </form>
        <p className="text-[0.8125rem] text-muted-foreground">
          Bringing existing progress? Choose an empty library, then use the import or restore
          instructions in the project’s migration guide. You can change your study preferences in
          Settings.
        </p>
      </Panel>
    </main>
  );
}
