import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MessageCircle, Send, Square } from 'lucide-react';
import type { ChatState } from '../../../shared/tutor-chat';
import { api } from '../../app/api';
import { Panel, ScrollRegion } from '../../components/kit';
import { ErrorNotice, Loading } from '../../components/ui';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';

const suggestions = [
  'What should I practise next?',
  'How am I progressing on my goals?',
  'Help me reflect on my latest attempt.',
];

function MessageText({ text, evidence }: { text: string; evidence: ChatState['evidence'] }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*|`[^`]+`|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/gi)
        .map((part, index) => {
          const record = evidence?.find((item) => item.id === part.replace(/^`|`$/g, ''));
          if (record)
            return (
              <Link key={index} to={`/attempts/${record.id}`} className="underline">
                {record.title} ↗
              </Link>
            );
          if (part.startsWith('`') && part.endsWith('`'))
            return <code key={index}>{part.slice(1, -1)}</code>;
          return part.startsWith('**') && part.endsWith('**') ? (
            <strong key={index}>{part.slice(2, -2)}</strong>
          ) : (
            part
          );
        })}
    </>
  );
}

export function TutorChat({
  request,
  visible,
}: {
  request?: { text: string; key: number };
  visible: boolean;
}) {
  const [message, setMessage] = useState('');
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
  useEffect(() => {
    if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [state?.messages.length, state?.draft, state?.proposals.length]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  if (!state) return null;
  const busy = state.status === 'starting' || state.status === 'working' || action.isPending;
  const ready = state.status === 'ready' && !action.isPending;
  const send = () => {
    if (!ready || !message.trim()) return;
    following.current = true;
    action.mutate(
      { path: 'message', body: { id: crypto.randomUUID(), message } },
      { onSuccess: () => setMessage('') },
    );
  };
  return (
    <>
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
              variant="ghost"
              disabled={busy}
              onClick={() => action.mutate({ path: 'cancel' })}
            >
              Close tutor
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {state.status === 'blocked' ? (
          <Panel title="Finish practice first">
            <p className="text-muted-foreground">
              The tutor is paused during active practice. Finish or cancel your attempt to continue.
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
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                      <MessageText text={item.text} evidence={state.evidence} />
                    </div>
                  </article>
                ))}
                {state.draft && (
                  <article aria-label="Tutor response" className="rounded-2xl border bg-card p-5">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">Tutor</p>
                    <div className="whitespace-pre-wrap break-words leading-relaxed">
                      {state.draft}
                    </div>
                  </article>
                )}
                {state.proposals.map((proposal) => (
                  <Panel
                    key={proposal.key}
                    title={
                      proposal.kind === 'goal'
                        ? 'Review goal change'
                        : 'Review teaching preferences'
                    }
                  >
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
                    <p className="mb-3 text-sm text-muted-foreground">
                      Nothing is saved until you confirm.
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
                          {approved ? 'Confirm and save' : 'Discard'}
                        </Button>
                      ))}
                    </div>
                  </Panel>
                ))}
              </div>
            </ScrollRegion>
            <div className="mx-auto w-full max-w-3xl space-y-2">
              <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {state.activity}
              </p>
              {state.status === 'closed' || state.status === 'error' ? (
                <Button disabled={action.isPending} onClick={() => action.mutate({ path: 'open' })}>
                  Open tutor
                </Button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    send();
                  }}
                  className="space-y-3"
                >
                  <label htmlFor="tutor-message" className="text-sm font-medium">
                    Message your tutor
                  </label>
                  <Textarea
                    id="tutor-message"
                    value={message}
                    maxLength={12000}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What would you like to work on?"
                    rows={3}
                    disabled={state.status === 'starting'}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Uses your Codex sign-in. Advice is based on recorded evidence and can be
                      incomplete.
                    </p>
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
