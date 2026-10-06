import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoaderCircle, Send } from 'lucide-react';
import type { ChatMessage } from '../../../shared/tutor-chat';
import type { InterviewHelp as Reply, TutorProvider } from '../../../shared/tutor';
import { api } from '../../app/api';
import { ScrollRegion } from '../../components/kit';
import { ErrorNotice, Field } from '../../components/ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { TutorMessage } from './TutorMessage';

/** What the attempt page lends the dock while an attempt is in progress. */
export interface PracticeHelpSession {
  attemptId: string;
  getDraft: () => { code: string; language: string };
  /** Append a line to the attempt notes; a new block starts a new stuck moment. */
  onNote: (text: string, newBlock: boolean) => void;
}
/** The help thread for one attempt; kept by the dock so minimising or navigating keeps it. */
export interface HelpThread {
  stuckAt: string;
  /** The stuck time of the last answered message, so a changed time starts a new block. */
  answeredAt: string | null;
  messages: ChatMessage[];
}
export const emptyThread: HelpThread = { stuckAt: '', answeredAt: null, messages: [] };

export function InterviewHelp({
  session,
  thread,
  setThread,
}: {
  session: PracticeHelpSession;
  thread: HelpThread;
  setThread: (update: (old: HelpThread) => HelpThread) => void;
}) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const tutor = useQuery({
    queryKey: ['tutor'],
    queryFn: () => api.get<{ settings: { provider: TutorProvider } }>('/tutor'),
  });
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [thread.messages.length, pending]);
  const validTime = /^[0-9]{1,4}:[0-5][0-9]$/.test(thread.stuckAt);
  async function send() {
    const text = message.trim();
    if (pending || !text || !validTime) return;
    const stuckAt = thread.stuckAt;
    const newStuck = thread.answeredAt !== stuckAt;
    const messages = [...thread.messages, { role: 'user' as const, text }];
    setThread((old) => ({ ...old, messages }));
    setMessage('');
    setPending(true);
    setError(null);
    try {
      const reply = await api.send<Reply>(`/attempts/${session.attemptId}/help`, 'POST', {
        stuckAt,
        newStuck,
        ...session.getDraft(),
        messages: messages.slice(-20),
      });
      setThread((old) => ({
        ...old,
        answeredAt: stuckAt,
        messages: [...old.messages, { role: 'assistant', text: reply.reply }],
      }));
      const hint = `Hint (${reply.level}): ${reply.hint}`;
      session.onNote(
        newStuck
          ? [
              `[Stuck at ${stuckAt}] Asked Bloom for help.`,
              ...(reply.analysis ? [`Where I was: ${reply.analysis}`] : []),
              hint,
            ].join('\n')
          : hint,
        newStuck,
      );
    } catch (e) {
      // Put the unanswered message back so it can be sent again.
      setThread((old) => ({ ...old, messages: old.messages.slice(0, -1) }));
      setMessage(text);
      setError(e);
    } finally {
      setPending(false);
    }
  }
  if (tutor.data?.settings.provider === 'off')
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Bloom can help like an interviewer while you practise once a tutor is chosen.
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link to="/settings">Choose a tutor in Settings → AI tutor</Link>
        </Button>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Stuck? Tell Bloom when it happened and what you're thinking. Your current code goes with
        each message, and each hint is added to your attempt notes.
      </p>
      <div className="w-36">
        <Field label="Stuck at">
          <Input
            placeholder="mm:ss"
            value={thread.stuckAt}
            onChange={(e) => {
              const stuckAt = e.target.value.trim();
              setThread((old) => ({ ...old, stuckAt }));
            }}
          />
        </Field>
      </div>
      <ScrollRegion ref={scroll}>
        <div className="flex flex-col gap-3 pb-2">
          {thread.messages.map((item, index) => (
            <article
              key={index}
              className={`rounded-2xl border p-3 ${item.role === 'user' ? 'ml-5 bg-muted' : 'bg-card'}`}
            >
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                {item.role === 'user' ? 'You' : 'Bloom'}
              </p>
              {item.role === 'assistant' ? (
                <TutorMessage text={item.text} />
              ) : (
                <div className="whitespace-pre-wrap break-words leading-relaxed">{item.text}</div>
              )}
            </article>
          ))}
        </div>
      </ScrollRegion>
      <div role="status" aria-live="polite">
        {pending && (
          <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            Bloom is thinking…
          </p>
        )}
      </div>
      {!!error && <ErrorNotice error={error} />}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="Message Bloom"
          value={message}
          maxLength={4000}
          rows={3}
          placeholder="What's blocking you?"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!event.repeat) event.currentTarget.form?.requestSubmit();
          }}
          className="max-h-48 rounded-2xl"
        />
        <div className="flex items-center justify-end gap-3">
          {!validTime && message.trim() && (
            <p className="text-sm text-muted-foreground">Add the Stuck at time to send.</p>
          )}
          <Button type="submit" disabled={pending || !validTime || !message.trim()}>
            <Send />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
