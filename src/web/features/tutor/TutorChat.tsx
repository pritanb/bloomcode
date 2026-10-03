import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { LoaderCircle, MessageCircle, Send, Square } from 'lucide-react';
import type { ChatState } from '../../../shared/tutor-chat';
import { api } from '../../app/api';
import { Panel, ScrollRegion } from '../../components/kit';
import { ErrorNotice, Loading } from '../../components/ui';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { TutorMessage } from './TutorMessage';

const suggestions = [
  'What should I practise next?',
  'How am I progressing on my goals?',
  'Help me reflect on my latest attempt.',
];

export function TutorChat({
  request,
  visible,
}: {
  request?: { text: string; key: number };
  visible: boolean;
}) {
  const [message, setMessage] = useState('');
  const location = useLocation();
  const attemptId = /^\/attempts\/([a-f0-9-]{36})$/i.exec(location.pathname)?.[1];
  useEffect(() => {
    if (request) setMessage(request.text);
  }, [request]);
  const cache = useQueryClient();
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const query = useQuery({
    queryKey: ['tutor-chat'],
    queryFn: () => api.get<ChatState>('/tutor-chat'),
    refetchInterval: visible ? 500 : false,
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.send(`/tutor-chat/${path}`, 'POST', body ?? {}),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['tutor-chat'] }),
  });
  const state = query.data;
  const attemptedStart = useRef(false);
  const { mutate, isPending } = action;
  useEffect(() => {
    if (!visible || state?.status === 'blocked' || state?.status === 'ready') {
      attemptedStart.current = false;
      return;
    }
    // Try once per opening/closed session; failures need an explicit retry.
    if (state?.status === 'closed' && !isPending && !attemptedStart.current) {
      attemptedStart.current = true;
      mutate({ path: 'open' });
    }
  }, [visible, state?.status, isPending, mutate]);
  const planUpdate = state?.activity === "Updated today's plan." ? state.activity : '';
  useEffect(() => {
    if (planUpdate) void cache.invalidateQueries({ queryKey: ['dashboard'] });
  }, [planUpdate, cache]);
  useEffect(() => {
    if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [state?.messages.length, state?.draft, state?.proposals.length]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  if (!state) return null;
  const busy = state.status === 'starting' || state.status === 'working' || action.isPending;
  const ready = state.status === 'ready' && !action.isPending;
  const send = (text = message, coach?: string) => {
    if (!ready || !text.trim()) return;
    following.current = true;
    action.mutate(
      {
        path: 'message',
        body: {
          id: crypto.randomUUID(),
          message: text,
          ...(attemptId ? { attemptId } : {}),
          ...(coach ? { coach } : {}),
        },
      },
      {
        onSuccess: () => {
          if (!coach) setMessage('');
        },
      },
    );
  };
  return (
    <>
      {state.coachingError && (
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          {state.coachingError}
        </p>
      )}
      {state.coaching && state.status !== 'blocked' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2 text-sm">
          <Link className="underline" to={`/attempts/${state.coaching.attemptId}`}>
            Coaching · {state.coaching.status}
          </Link>
          <Button
            size="sm"
            variant="outline"
            disabled={!ready}
            onClick={() =>
              action.mutate({
                path: 'coaching',
                body: {
                  id: crypto.randomUUID(),
                  action: state.coaching?.status === 'paused' ? 'resume' : 'pause',
                },
              })
            }
          >
            {state.coaching.status === 'paused' ? 'Resume coaching' : 'Return to chat'}
          </Button>
          {state.coaching.needsRetry && (
            <Button
              size="sm"
              disabled={!ready}
              onClick={() =>
                action.mutate({
                  path: 'coaching',
                  body: { id: crypto.randomUUID(), action: 'retry' },
                })
              }
            >
              Retry step
            </Button>
          )}
        </div>
      )}
      <div className="mb-3 flex shrink-0 flex-wrap gap-2">
        {state.status === 'ready' && (
          <>
            <Button
              variant="outline"
              disabled={busy || state.proposals.length > 0}
              onClick={() => action.mutate({ path: 'new' })}
            >
              New conversation
            </Button>
            <Button
              variant="outline"
              disabled={busy || !!state.coachingError || state.proposals.length > 0}
              onClick={() =>
                send(
                  attemptId
                    ? 'Coach me through this attempt.'
                    : 'Coach me through my latest attempt.',
                  attemptId ? 'this' : 'latest',
                )
              }
            >
              {attemptId ? 'Coach this attempt' : 'Coach latest attempt'}
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {state.status === 'blocked' ? (
          <Panel title="Finish practice first">
            <p className="text-muted-foreground">
              Chat is paused during active practice. Open your attempt and ask Bloom there for
              interview-style help, or finish or cancel it to chat.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/">Back to study desk</Link>
            </Button>
          </Panel>
        ) : (
          <>
            {(action.error || state.error) && (
              <ErrorNotice error={action.error ?? new Error(state.error!)} />
            )}
            <ScrollRegion
              ref={scroll}
              onScroll={(event) => {
                const node = event.currentTarget;
                following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              }}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-4">
                {state.messages.length === 0 && (
                  <Panel title="A conversation about your learning" icon={MessageCircle}>
                    <p className="mb-5 text-muted-foreground">
                      Your tutor can use recorded attempts, topic scores, goals and teaching
                      preferences. Changes to goals or preferences are yours to approve.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          variant="outline"
                          className="h-auto whitespace-normal py-2 text-left"
                          onClick={() => setMessage(suggestion)}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </Panel>
                )}
                {state.messages.map((item, index) => (
                  <article
                    key={index}
                    className={`rounded-2xl border p-4 ${item.role === 'user' ? 'ml-5 bg-muted' : 'bg-card'}`}
                  >
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">
                      {item.role === 'user' ? 'You' : 'Tutor'}
                    </p>
                    {item.role === 'assistant' ? (
                      <TutorMessage text={item.text} evidence={state.evidence} />
                    ) : (
                      <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {item.text}
                      </div>
                    )}
                  </article>
                ))}
                {state.draft && (
                  <article aria-label="Tutor response" className="rounded-2xl border bg-card p-5">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">Tutor</p>
                    <TutorMessage text={state.draft} evidence={state.evidence} />
                  </article>
                )}
                {state.proposals.map((proposal) => (
                  <Panel
                    key={proposal.key}
                    title={
                      proposal.kind === 'goal'
                        ? 'Review goal change'
                        : proposal.kind === 'plan'
                          ? proposal.change.mode === 'replace'
                            ? "Replace today's plan"
                            : "Add to today's plan"
                          : 'Review teaching preferences'
                    }
                  >
                    {proposal.kind === 'plan' ? (
                      <ul className="mb-4 space-y-2">
                        {(proposal.change.items as { title: string; reason: string }[]).map(
                          (item) => (
                            <li key={item.title}>
                              <p className="font-medium">{item.title}</p>
                              <p className="text-sm text-muted-foreground">{item.reason}</p>
                            </li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <dl className="mb-4 space-y-2">
                        {Object.entries(proposal.change)
                          .filter(([key]) => !['expectedVersion', 'goalId'].includes(key))
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs text-muted-foreground">
                                {(
                                  {
                                    explanationDepth: 'Explanation depth',
                                    hintStyle: 'Hint style',
                                    text: 'Goal',
                                    state: 'New state',
                                    action: 'Action',
                                  } as Record<string, string>
                                )[key] ?? key}
                              </dt>
                              <dd className="whitespace-pre-wrap break-words">
                                {String(value).replaceAll('_', ' ')}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )}
                    <p className="mb-3 text-sm text-muted-foreground">
                      {proposal.kind !== 'plan'
                        ? 'Nothing is saved until you confirm.'
                        : proposal.change.mode === 'replace'
                          ? 'Unstarted questions are swapped for these; started and finished work stays. Nothing changes until you confirm.'
                          : 'Nothing is added until you confirm.'}
                    </p>
                    <div className="flex gap-2">
                      {[true, false].map((approved) => (
                        <Button
                          key={String(approved)}
                          variant={approved ? 'default' : 'outline'}
                          disabled={!ready}
                          onClick={() =>
                            action.mutate({
                              path: 'confirm',
                              body: {
                                id: crypto.randomUUID(),
                                key: proposal.key,
                                kind: proposal.kind,
                                approved,
                              },
                            })
                          }
                        >
                          {approved
                            ? proposal.kind === 'plan'
                              ? proposal.change.mode === 'replace'
                                ? 'Use this plan'
                                : 'Add to plan'
                              : 'Confirm and save'
                            : 'Discard'}
                        </Button>
                      ))}
                    </div>
                  </Panel>
                ))}
              </div>
            </ScrollRegion>
            <div className="mx-auto w-full max-w-3xl space-y-2">
              <div role="status" aria-live="polite" aria-atomic="true">
                {busy ? (
                  <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3">
                    <LoaderCircle
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
                    />
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        {state.status === 'starting'
                          ? 'Bloom is starting…'
                          : state.status === 'working'
                            ? state.draft
                              ? 'Bloom is writing…'
                              : 'Bloom is thinking…'
                            : action.variables?.path === 'message'
                              ? 'Sending your message…'
                              : 'Updating Bloom…'}
                      </p>
                      {state.activity && (
                        <p className="mt-1 text-xs text-muted-foreground">{state.activity}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  state.activity && (
                    <p className="text-sm text-muted-foreground">{state.activity}</p>
                  )
                )}
              </div>
              {state.status === 'closed' || state.status === 'error' ? (
                <Button disabled={action.isPending} onClick={() => action.mutate({ path: 'open' })}>
                  {action.isPending ? 'Connecting…' : 'Retry connection'}
                </Button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    send();
                  }}
                  className="space-y-3"
                >
                  <Textarea
                    id="tutor-message"
                    aria-label="Message your tutor"
                    value={message}
                    maxLength={12000}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key !== 'Enter' ||
                        event.shiftKey ||
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      )
                        return;
                      event.preventDefault();
                      if (!event.repeat) event.currentTarget.form?.requestSubmit();
                    }}
                    className="rounded-2xl border-transparent bg-[color-mix(in_srgb,var(--foreground)_6%,var(--background))] px-4 py-3 shadow-none focus-visible:ring-1 dark:bg-muted"
                    placeholder="Ask a question, or use /coach followed by a problem name"
                    rows={3}
                    disabled={state.status === 'starting'}
                  />
                  <div className="flex justify-end gap-3">
                    {busy ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => action.mutate({ path: 'cancel' })}
                      >
                        <Square />
                        Stop
                      </Button>
                    ) : (
                      <Button type="submit" disabled={!ready || !message.trim()}>
                        <Send />
                        Send
                      </Button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
