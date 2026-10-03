import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { api } from '../../app/api';
import { Panel } from '../../components/kit';
import { ErrorNotice, useAction } from '../../components/ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Signals = {
  acceptedFirstTry: boolean | null;
  difficulty: 'too_easy' | 'too_hard' | null;
};

function useSignals(attemptId: string) {
  const query = useQuery({
    queryKey: ['attempt-signals', attemptId],
    queryFn: () => api.get<Signals>(`/attempts/${attemptId}/signals`),
  });
  const save = useAction((change: Partial<Signals>) =>
    api.send<Signals>(`/attempts/${attemptId}/signals`, 'PATCH', change),
  );
  return {
    query,
    save,
    value: save.variables && save.isPending ? { ...query.data!, ...save.variables } : query.data,
  };
}

function Choice<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
  disabled,
  size,
}: {
  label: string;
  options: [T, string][];
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  disabled?: boolean;
  size?: 'sm';
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([option, text]) => (
        <Button
          key={String(option)}
          type="button"
          size="sm"
          variant={value === option ? 'default' : 'outline'}
          aria-pressed={value === option}
          disabled={disabled}
          className={cn(size === 'sm' && 'h-7 px-2 text-[0.75rem]')}
          // A second press clears the answer.
          onClick={() => onChange(value === option ? null : option)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

const difficultyOptions: ['too_easy' | 'too_hard', string][] = [
  ['too_easy', 'Too easy'],
  ['too_hard', 'Too hard'],
];

/** Results LeetCode doesn't tell BloomCode: first-try acceptance and how hard it felt. */
export function AttemptSignals({ attemptId }: { attemptId: string }) {
  const { query, save, value } = useSignals(attemptId);
  return (
    <Panel title="How did it go?" icon={Gauge} className="gap-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        These, with your outcome, help, time and confidence, set your training level for this topic.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.875rem] font-medium">Accepted on first submission?</span>
        <Choice
          label="Accepted on first submission?"
          options={[
            [true, 'Yes'],
            [false, 'No'],
          ]}
          value={value?.acceptedFirstTry}
          disabled={query.isPending || save.isPending}
          onChange={(acceptedFirstTry) => save.mutate({ acceptedFirstTry })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.875rem] font-medium">How did it feel?</span>
        <Choice
          label="How did it feel?"
          options={difficultyOptions}
          value={value?.difficulty}
          disabled={query.isPending || save.isPending}
          onChange={(difficulty) => save.mutate({ difficulty })}
        />
      </div>
      <ErrorNotice error={query.error ?? save.error} />
    </Panel>
  );
}

/** Compact too easy / too hard buttons for a finished plan item. */
export function DifficultyButtons({ attemptId }: { attemptId: string }) {
  const { query, save, value } = useSignals(attemptId);
  return (
    <Choice
      label="How did it feel?"
      size="sm"
      options={difficultyOptions}
      value={value?.difficulty}
      disabled={query.isPending || save.isPending}
      onChange={(difficulty) => save.mutate({ difficulty })}
    />
  );
}
