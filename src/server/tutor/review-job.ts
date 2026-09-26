import { type Db, transaction } from '../db/db.js';
import { getAttempt } from '../attempts/attempt-model.js';
import type { AutoReviewQueue } from '../attempts/auto-review-queue.js';
import { attemptContext, type AttemptContext } from '../attempts/attempt-context.js';
import { saveReview } from '../scoring/review-model.js';
import type { Generate } from './generate.js';

// Writes the tutor report for attempts submitted in the web app.
export const reviewSystemPrompt = `You are a supportive LeetCode interview tutor reviewing one finished practice attempt.
Write a short report the learner reads straight after submitting. Plain text only: no Markdown headings, bold, tables or code fences.
Use exactly these labelled sections, each 1-4 short lines:
Summary:
What went well:
What to improve:
Complexity: (time and space of the submitted code, and whether a better bound exists)
Practise next:
Judge the submitted code itself: correctness, edge cases, clarity and interview communication. Be specific and honest; do not invent test results. Do not reveal a full alternative solution, only the key idea to try.`;
const mins = (s: number | null) =>
  s === null ? 'unknown' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function reviewPrompt({ attempt: a, history }: AttemptContext): string {
  const past = history
    .filter((h) => h.status === 'completed')
    .slice(0, 5)
    .map(
      (h) =>
        `- ${h.finishedAt?.slice(0, 10) ?? 'unknown date'}: ${h.outcome ?? 'unknown'}, help ${h.help}, ${mins(h.activeSeconds)}`,
    )
    .join('\n');
  const moved = (a.scoreDecisions ?? [])
    .map((d) => `${d.topicName} ${d.oldScore} -> ${d.newScore}`)
    .join(', ');
  return [
    `Problem: ${a.problem.title} (${a.problem.difficulty ?? 'unknown difficulty'}) ${a.problem.url}`,
    `Outcome: ${a.outcome ?? 'unknown'}; help used: ${a.help}; solve time: ${mins(a.activeSeconds)}; confidence: ${a.confidence ?? 'not given'}/5`,
    moved ? `Topic scores moved: ${moved}` : 'No topic score moved.',
    past ? `Earlier attempts at this problem:\n${past}` : 'First recorded attempt at this problem.',
    a.notes.trim() ? `Learner's notes:\n${a.notes.trim()}` : "Learner's notes: none",
    `Submitted ${a.language} code:\n${a.code}`,
  ].join('\n\n');
}
/** Write the report for the next queued attempt. Returns whether there was one. */
export async function reviewNext(
  { db, clock, reviews }: { db: Db; clock: () => Date; reviews: AutoReviewQueue },
  generate: Generate,
): Promise<boolean> {
  const next = reviews.take(db);
  if (!next) return false;
  try {
    const feedback = (
      await generate({
        kind: 'review',
        system: reviewSystemPrompt,
        user: reviewPrompt(attemptContext(db, next.id)),
        maxTokens: 1200,
        timeoutMs: 180_000,
      })
    ).text.trim();
    if (!feedback) throw new Error('The tutor returned an empty report.');
    // Re-read the version: the learner may have saved a reflection meanwhile.
    transaction(db, () => {
      const a = getAttempt(db, next.id);
      if (!a.feedback) saveReview(db, clock, a.id, { version: a.version, feedback, decisions: [] });
    });
    reviews.done(next.id);
  } catch (error) {
    reviews.fail(
      next.id,
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : 'The tutor could not write this report.',
    );
  }
  return true;
}
