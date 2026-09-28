// Host-side executable discovery only. All model execution lives in Python.
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexErrorKind } from '../../shared/tutor.js';

export class CodexError extends Error {
  constructor(
    public kind: CodexErrorKind,
    message: string,
  ) {
    super(message);
  }
}
export const CODEX_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  join(homedir(), '.local/bin/codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
];

export async function findCodex(
  configured: string | null,
  candidates = CODEX_CANDIDATES,
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
export function codexVersion(path: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(path, ['--version'], { timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim() || null),
    ),
  );
}
