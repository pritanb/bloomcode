// Interview-style help during an attempt. Only the problem, current code and the help
// thread reach the provider; notes and the help level are recorded by the browser.
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { ApiError, conflict } from '../db/errors.js';
import { getAttempt } from '../attempts/attempt-model.js';
import type { InterviewHelp } from '../../shared/tutor.js';
import { TutorError } from './cli.js';

export const helpRequest = z
  .object({
    stuckAt: z.string().regex(/^[0-9]{1,4}:[0-5][0-9]$/, 'Enter the time as minutes:seconds'),
    newStuck: z.boolean(),
    language: z.string().min(1).max(80),
    code: z.string().max(20000),
    messages: z
      .array(
        z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(4000) }),
      )
      .min(1)
      .max(20),
  })
  .strict();
const helpResult = z
  .object({
    reply: z.string().min(1).max(3000),
    hint: z.string().min(1).max(300),
    level: z.enum(['small', 'major']),
    analysis: z.string().max(800).nullable(),
  })
  .strict();

export async function interviewHelp(
  db: Db,
  attemptId: string,
  body: unknown,
  help: (context: unknown) => Promise<{ text: string }>,
): Promise<InterviewHelp> {
  const b = helpRequest.parse(body);
  const a = getAttempt(db, attemptId);
  if (a.status === 'completed') throw conflict('Interview help is only for an attempt in progress');
  const { title, url, difficulty } = a.problem;
  try {
    const { text } = await help({ problem: { title, url, difficulty }, ...b });
    return helpResult.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof TutorError) throw new ApiError(503, 'TUTOR_HELP', error.message);
    throw new ApiError(502, 'TUTOR_HELP', 'Bloom could not answer. Send your message again.');
  }
}
