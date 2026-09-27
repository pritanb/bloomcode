import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

type Position = { x: number; y: number };
const margin = 12;
const readPosition = (key: string): Position | null => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
  } catch {
    return null;
  }
};

/** Position only: dragging never touches tutor or study state. */
export function useFloatingPosition<T extends HTMLElement>(key: string, visible: boolean) {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState<Position | null>(() => readPosition(key));
  const positionRef = useRef(position);
  const drag = useRef<{ id: number; startX: number; startY: number; origin: Position } | null>(
    null,
  );
  const moved = useRef(false);
  const bounds = (point: Position): Position => {
    const rect = ref.current?.getBoundingClientRect();
    return {
      x: Math.max(margin, Math.min(point.x, window.innerWidth - (rect?.width ?? 0) - margin)),
      y: Math.max(margin, Math.min(point.y, window.innerHeight - (rect?.height ?? 0) - margin)),
    };
  };
  const place = (point: Position, save = false) => {
    const next = bounds(point);
    positionRef.current = next;
    setPosition((previous) => (previous?.x === next.x && previous?.y === next.y ? previous : next));
    if (save) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Storage is optional. */
      }
    }
  };
  const reset = () => place({ x: window.innerWidth, y: window.innerHeight }, true);
  useLayoutEffect(() => {
    if (!visible || !ref.current) return;
    const fit = () => place(positionRef.current ?? { x: window.innerWidth, y: window.innerHeight });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(ref.current);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      drag.current = null;
    };
    // The position ref is current; resizing must not recreate the drag handlers.
  }, [visible]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    moved.current = false;
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: rect.left, y: rect.top },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.startX,
      dy = event.clientY - active.startY;
    if (!moved.current && Math.hypot(dx, dy) < 5) return;
    moved.current = true;
    place({ x: active.origin.x + dx, y: active.origin.y + dy });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (positionRef.current) place(positionRef.current, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      reset();
      return;
    }
    const delta: Record<string, Position> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const step = delta[event.key];
    if (!step || !positionRef.current) return;
    event.preventDefault();
    const amount = event.shiftKey ? 40 : 10;
    place(
      { x: positionRef.current.x + step.x * amount, y: positionRef.current.y + step.y * amount },
      true,
    );
  };
  return {
    ref,
    style: (position
      ? { left: position.x, top: position.y }
      : { right: margin, bottom: margin }) as CSSProperties,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onKeyDown,
    },
    consumeDrag: () => {
      const value = moved.current;
      moved.current = false;
      return value;
    },
    reset,
  };
}
