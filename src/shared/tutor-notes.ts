import { z } from 'zod';

const text = z.string().trim().min(1).max(300);
// A training-ladder topic such as "Tries", or null for a general lesson. The server checks the name.
const topic = z.string().trim().min(1).max(60).nullable();
const noteId = z.string().uuid();
const expectedVersion = z.number().int().nonnegative();

export const noteChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), text, topic }).strict(),
  z
    .object({ action: z.literal('update'), noteId, expectedVersion, oldText: text, text, topic })
    .strict(),
  z.object({ action: z.literal('retire'), noteId, expectedVersion, text }).strict(),
]);
export const confirmedNoteChange = z
  .object({
    change: noteChange,
    sourceConversation: z.string().min(1).max(200),
  })
  .strict();

export type TutorNote = {
  id: string;
  text: string;
  topic: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** About 50 lessons. Past this, Bloom gets general lessons and the topics in play, and looks up the rest. */
export const NOTE_BUDGET = 8000;

export function notesInBudget<T extends Pick<TutorNote, 'text' | 'topic'>>(
  notes: T[],
  topicsInPlay: () => Iterable<string | null>,
  budget = NOTE_BUDGET,
) {
  if (notes.reduce((sum, n) => sum + n.text.length, 0) <= budget)
    return { notes, total: notes.length, hasMore: false };
  const inPlay = new Set(topicsInPlay());
  const shown = notes.filter((n) => n.topic === null || inPlay.has(n.topic));
  return { notes: shown, total: notes.length, hasMore: shown.length < notes.length };
}
