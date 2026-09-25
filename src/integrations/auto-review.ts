import { analyzeTopicsNext } from './topic-analysis.js';
import { analyzeNext } from './learning-insights.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Attempt, Topic } from '../shared/contracts.js';
import { ApiError, type LocalApi } from './local-api.js';
import { samplingGenerate, type Api, type Generate } from './generate.js';

// Writes the tutor report for attempts submitted in the web app. The model is
// supplied by the caller: the MCP client via sampling, or the app's Codex worker.
type Context = { attempt: Attempt; history: Attempt[]; topics: Topic[] };
const POLL_MS = 3000;
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
export function reviewPrompt({ attempt: a, history }: Context): string {
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
/** Claim one queued attempt, generate its report and save it. Returns whether a job was found. */
export async function reviewNext(api: Api, generate: Generate): Promise<boolean> {
  const { job } = (await api.request('POST', '/api/auto-reviews/claim', {})) as {
    job: { attemptId: string; claimId: string } | null;
  };
  if (!job) return false;
  try {
    const context = (await api.request('GET', `/api/attempts/${job.attemptId}/context`)) as Context;
    const feedback = (
      await generate({
        kind: 'review',
        system: reviewSystemPrompt,
        user: reviewPrompt(context),
        maxTokens: 1200,
        timeoutMs: 180_000,
      })
    ).text.trim();
    if (!feedback) throw new ApiError('EMPTY_REVIEW', 'The tutor returned an empty report.');
    // Re-read the version: the learner may have saved a reflection meanwhile.
    const current = (await api.request('GET', `/api/attempts/${job.attemptId}`)) as Attempt;
    if (current.feedback) return true;
    await api.request(
      'POST',
      `/api/attempts/${job.attemptId}/reviews`,
      { version: current.version, feedback },
      `auto-review:${job.claimId}`,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message.slice(0, 500)
        : 'The tutor could not write this report.';
    await api
      .request('POST', `/api/auto-reviews/${job.attemptId}/fail`, { claimId: job.claimId, message })
      .catch(() => {});
  }
  return true;
}
/** Poll for queued tutor work until stopped. Returns a stop function. */
export function startTutorLoop(
  api: Api,
  generate: Generate,
  options: {
    reportBudgetMs?: number;
    sequential?: boolean;
    ready?: () => boolean | Promise<boolean>;
  } = {},
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let topicTimer: NodeJS.Timeout | undefined;
  const ready = options.ready ?? (() => true);
  const tick = async () => {
    let found = false;
    try {
      if (await ready()) {
        found =
          (await reviewNext(api, generate)) ||
          (await analyzeNext(api, generate, options.reportBudgetMs));
        // A single runner (Codex) takes topic work in the same queue, one job at a time.
        if (!found && options.sequential) found = await analyzeTopicsNext(api, generate);
      }
    } catch {
      /* app not running yet; keep polling */
    }
    if (!stopped) timer = setTimeout(() => void tick(), found ? 0 : POLL_MS);
  };
  const topicTick = async () => {
    try {
      await analyzeTopicsNext(api, generate);
    } catch {
      /* Independent topic requests retry on the next poll. */
    }
    if (!stopped) topicTimer = setTimeout(() => void topicTick(), POLL_MS);
  };
  void tick();
  if (!options.sequential) void topicTick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(topicTimer);
  };
}
/** MCP sampling: the connected client (Hermes) runs the model. */
export function startAutoReviews(server: Server, api: LocalApi): () => void {
  return startTutorLoop(api, samplingGenerate(server));
}
