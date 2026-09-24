import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One server owns a workspace; stale claims never share a new owner's filename. */
export function acquireServerLock(dataDir) {
  const directory = join(dataDir, 'server-locks');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = `${process.pid}-${randomUUID()}.lock`;
  const path = join(directory, name);
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  try {
    // Publish before inspecting: simultaneous starts may both refuse, never both win.
    for (const other of readdirSync(directory)) {
      if (other === name) continue;
      const match = /^(\d+)-[a-f0-9-]+\.lock$/.exec(other);
      if (!match) continue;
      let alive = true;
      try { process.kill(Number(match[1]), 0); }
      catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('This study workspace is already open in another server. Quit that server and try again.');
      try { unlinkSync(join(directory, other)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return release;
  } catch (error) { release(); throw error; }
}
