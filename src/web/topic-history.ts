import type { TopicScorePoint } from '../shared/contracts';

export function topicHistory(decisions: TopicScorePoint[]) {
  // API history arrives newest first. Reverse first to retain recording order
  // when imported entries have the same date and recordedAt timestamp.
  const ordered = [...decisions].reverse().sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt));
  const days = new Map<string, { date: string; time: number; score: number }>();
  for (const decision of ordered) {
    const time = Date.parse(`${decision.date}T00:00:00Z`);
    if (!Number.isFinite(time)) continue;
    days.set(decision.date, { date: decision.date, time, score: decision.newScore });
  }
  return { ordered, points: [...days.values()] };
}
