import { TutorMessage } from '../tutor/TutorMessage';

type Source = { id: string; attemptId: string; problemTitle: string };

/** Older reports embedded observation hashes in prose. Keep their citations readable. */
export function InsightText({ text, sources }: { text: string; sources: Source[] }) {
  const formatted = text.replace(/\b[a-f0-9]{64}\b/gi, (id) => {
    const index = sources.findIndex((source) => source.id.toLowerCase() === id.toLowerCase());
    return index < 0
      ? 'unverified source'
      : `[source ${index + 1}](/attempts/${sources[index].attemptId})`;
  });
  return (
    <TutorMessage
      text={formatted}
      evidence={sources.map((source) => ({ id: source.attemptId, title: source.problemTitle }))}
    />
  );
}
