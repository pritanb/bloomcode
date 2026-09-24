import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/** Shared by the launcher, server and integrations. Never move existing data. */
export function resolveDataDir({ env = process.env, platform = process.platform, home = homedir(), exists = existsSync } = {}) {
  if (env.DATA_DIR) return resolve(env.DATA_DIR);
  if (platform === 'darwin') {
    const legacy = join(home, 'Library', 'Application Support', 'LeetcodeTutor-dev');
    if (exists(join(legacy, 'leetcode.sqlite'))) return legacy;
    return join(home, 'Library', 'Application Support', 'LeetCodeTutor');
  }
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'LeetCodeTutor');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'leetcode-tutor');
}
