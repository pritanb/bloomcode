import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { MessageCircle, Minus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { TutorChat } from './TutorChat';

const TutorContext = createContext<(attemptId?: string) => void>(() => {});
export const useTutor = () => useContext(TutorContext);

/** Lives above routes so navigation and minimising preserve the conversation and draft. */
export function TutorDock({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [request, setRequest] = useState<{ text: string; key: number }>();
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
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
      {children}
      {visited && (
        <aside
          id="tutor-panel"
          ref={panel}
          tabIndex={-1}
          aria-label="Your tutor"
          hidden={!open}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              minimise();
            }
          }}
          className={`fixed bottom-4 right-4 z-40 ${open ? 'flex' : 'hidden'} h-[min(760px,calc(100dvh-80px))] w-[min(460px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl outline-none`}
        >
          <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
              <MessageCircle className="size-5" /> Your tutor
            </h2>
            <Button size="icon" variant="ghost" aria-label="Minimise tutor" onClick={minimise}>
              <Minus />
            </Button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <TutorChat request={request} visible={open} />
          </div>
        </aside>
      )}
      {!open && (
        <Button
          ref={launcher}
          className="fixed bottom-5 right-5 z-40 rounded-full px-5 shadow-lg"
          aria-controls="tutor-panel"
          aria-expanded={false}
          onClick={() => show()}
        >
          <MessageCircle /> Ask your tutor
        </Button>
      )}
    </TutorContext.Provider>
  );
}
