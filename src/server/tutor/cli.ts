// Host-side helpers shared by the Codex and Claude Code providers. All model
// execution lives in Python; the host only finds the CLI and classifies errors.
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { TutorErrorKind } from '../../shared/tutor.js';

export class TutorError extends Error {
  constructor(
    public kind: TutorErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export async function findExecutable(
  configured: string | null,
  candidates: string[],
): Promise<string | null> {
  for (const path of configured ? [configured] : candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* try the next location */
    }
  }
  return null;
}
export function cliVersion(path: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(path, ['--version'], { timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim() || null),
    ),
  );
}
