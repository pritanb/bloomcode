import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const database = 'leetcode.sqlite';

/**
 * Platform workspace locations. `current` is the BloomCode default for new installations;
 * `legacy` lists pre-rename locations in precedence order. `requiresDatabase` marks a legacy
 * directory that is only used when it already holds a database.
 */
export function dataDirLocations({
  env = process.env,
  platform = process.platform,
  home = homedir(),
} = {}) {
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return {
      current: join(support, 'BloomCode'),
      legacy: [
        { path: join(support, 'LeetcodeTutor-dev'), requiresDatabase: true },
        { path: join(support, 'LeetCodeTutor'), requiresDatabase: false },
      ],
    };
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return {
      current: join(base, 'BloomCode'),
      legacy: [{ path: join(base, 'LeetCodeTutor'), requiresDatabase: false }],
    };
  }
  const base = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return {
    current: join(base, 'bloomcode'),
    legacy: [{ path: join(base, 'leetcode-tutor'), requiresDatabase: false }],
  };
}

/**
 * Shared by the desktop app, server and integrations. Never move existing data: a BloomCode
 * workspace with a database wins, otherwise an existing pre-rename workspace keeps being used
 * in place, and only a fresh installation gets the BloomCode directory.
 */
export function resolveDataDir({
  env = process.env,
  platform = process.platform,
  home = homedir(),
  exists = existsSync,
} = {}) {
  if (env.DATA_DIR) return resolve(env.DATA_DIR);
  const { current, legacy } = dataDirLocations({ env, platform, home });
  // The desktop profile may create the BloomCode folder first, so only its database counts.
  if (exists(join(current, database))) return current;
  for (const { path, requiresDatabase } of legacy) {
    if (exists(requiresDatabase ? join(path, database) : path)) return path;
  }
  return current;
}
