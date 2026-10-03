// Host-side executable discovery only. All model execution lives in Python.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findExecutable } from './cli.js';

export const CODEX_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex',
  join(homedir(), '.local/bin/codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
];

export function findCodex(configured: string | null, candidates = CODEX_CANDIDATES) {
  return findExecutable(configured, candidates);
}
