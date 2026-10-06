import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { GripHorizontal, Minus, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { TutorChat } from './TutorChat';
import {
  emptyThread,
  InterviewHelp,
  type HelpThread,
  type PracticeHelpSession,
} from './InterviewHelp';
import { TutorPet } from './TutorPet';
import { useFloatingPosition } from './useFloatingPosition';

const TutorContext = createContext<(attemptId?: string) => void>(() => {});
export const useTutor = () => useContext(TutorContext);
const PracticeHelpContext = createContext<(session: PracticeHelpSession | null) => void>(() => {});
/** While registered, the dock offers interview help for this attempt instead of chat. */
export function usePracticeHelp(session: PracticeHelpSession | null) {
  const register = useContext(PracticeHelpContext);
  useEffect(() => {
    register(session);
    return () => register(null);
  }, [register, session]);
}

/** Lives above routes so navigation and minimising preserve the conversation and draft. */
export function TutorDock({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [request, setRequest] = useState<{ text: string; key: number }>();
  const [practice, setPractice] = useState<PracticeHelpSession | null>(null);
  const [threads, setThreads] = useState<Record<string, HelpThread>>({});
  const petPosition = useFloatingPosition<HTMLButtonElement>('bloomcode.tutor.pet-position', !open);
  const panelPosition = useFloatingPosition<HTMLElement>('bloomcode.tutor.panel-position', open);
  const launcher = petPosition.ref;
  const panel = panelPosition.ref;
  const show = (attemptId?: string) => {
    if (attemptId)
      setRequest({ text: `Help me reflect on attempt ${attemptId}.`, key: Date.now() });
    setVisited(true);
    setOpen(true);
    requestAnimationFrame(() => panel.current?.focus());
  };
  const minimise = () => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };
  return (
    <TutorContext.Provider value={show}>
      <PracticeHelpContext.Provider value={setPractice}>{children}</PracticeHelpContext.Provider>
      <span id="tutor-move-help" className="sr-only">
        Drag to move, or use the arrow keys while focused. Hold Shift for larger steps. Press Home
        to return to the bottom right.
      </span>
      {visited && (
        <aside
          id="tutor-panel"
          ref={panel}
          tabIndex={-1}
          aria-label="Your tutor"
          hidden={!open}
          style={panelPosition.style}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              minimise();
            }
          }}
          className={`fixed z-40 ${open ? 'flex' : 'hidden'} h-[min(760px,calc(100dvh-24px))] w-[min(460px,calc(100vw-24px))] flex-col overflow-clip rounded-2xl border bg-background shadow-2xl outline-none`}
        >
          <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
            <button
              type="button"
              {...panelPosition.handlers}
              aria-label="Move tutor window"
              aria-describedby="tutor-move-help"
              title="Drag to move · Arrow keys to reposition"
              className="flex min-w-0 flex-1 touch-none select-none items-center gap-2 rounded-lg py-1 text-left cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring"
            >
              <TutorPet className="size-12 shrink-0" />
              <span className="flex-1">
                <span className="block font-heading text-base font-semibold">Bloom</span>
                <span className="block text-xs text-muted-foreground">
                  {practice ? 'Interview help' : 'Your coding tutor'}
                </span>
              </span>
              <GripHorizontal className="size-4 text-muted-foreground" />
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reset tutor position"
              title="Reset position"
              onClick={() => {
                panelPosition.reset();
                petPosition.reset();
              }}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Minimise tutor" onClick={minimise}>
              <Minus />
            </Button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {practice ? (
              <InterviewHelp
                key={practice.attemptId}
                session={practice}
                thread={threads[practice.attemptId] ?? emptyThread}
                setThread={(update) =>
                  setThreads((old) => ({
                    ...old,
                    [practice.attemptId]: update(old[practice.attemptId] ?? emptyThread),
                  }))
                }
              />
            ) : (
              <TutorChat request={request} visible={open} />
            )}
          </div>
        </aside>
      )}
      {!open && (
        <button
          type="button"
          ref={launcher}
          style={petPosition.style}
          {...petPosition.handlers}
          className="group fixed z-40 flex w-24 touch-none select-none flex-col items-center rounded-2xl pb-1 text-foreground cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label="Ask your tutor"
          aria-describedby="tutor-move-help"
          title="Chat with Bloom · Drag to move"
          aria-controls="tutor-panel"
          aria-expanded={false}
          onClick={() => {
            if (!petPosition.consumeDrag()) show();
          }}
        >
          <TutorPet className="h-24 w-24 drop-shadow-sm motion-safe:transition-transform motion-safe:group-hover:-translate-y-1" />
          <span className="rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm">
            Ask Bloom
          </span>
        </button>
      )}
    </TutorContext.Provider>
  );
}
