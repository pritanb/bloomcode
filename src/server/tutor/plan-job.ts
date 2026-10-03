import type { PlanDrafts } from '../plans/plan-drafts.js';
import type { Generate } from './generate.js';
import { parseJson } from './insight-job.js';

/** Let Bloom plan today when a plan is waiting for it. Returns whether one was. */
export async function draftPlanNext(drafts: PlanDrafts, generate: Generate): Promise<boolean> {
  const work = drafts.claim();
  if (!work) return false;
  try {
    // Numbered candidates and checks avoid asking the model to reproduce database IDs.
    const { text } = await generate({ kind: 'plan', context: work.context, timeoutMs: 150_000 });
    drafts.complete(work, parseJson(text));
  } catch (error) {
    drafts.fail(work, error instanceof Error ? error.message : 'Bloom could not plan today');
  }
  return true;
}
