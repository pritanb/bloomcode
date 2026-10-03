// Host-side executable discovery only. All model execution lives in Python.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findExecutable } from './cli.js';

export const CLAUDE_CANDIDATES = [
  join(homedir(), '.local/bin/claude'),
  join(homedir(), '.claude/local/claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
];

export function findClaude(configured: string | null, candidates = CLAUDE_CANDIDATES) {
  return findExecutable(configured, candidates);
}
