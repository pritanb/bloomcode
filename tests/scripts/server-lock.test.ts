import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { acquireServerLock } from '../../scripts/server-lock.mjs';

const directories: string[] = [];
const children: ChildProcess[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'tutor-lock-test-'));
  directories.push(dir);
  return dir;
}
const moduleURL = new URL('../../scripts/server-lock.mjs', import.meta.url).href;
const claimant = `import { acquireServerLock } from ${JSON.stringify(moduleURL)}; const release=acquireServerLock(process.argv[1]); console.log('owned'); if(process.argv[2]==='hold'){setInterval(()=>{},1000);}else{release();}`;
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe('server workspace ownership', () => {
  it('blocks another process while owned and allows it after release', () => {
    const dir = workspace();
    const release = acquireServerLock(dir);
    const blocked = spawnSync(process.execPath, ['--input-type=module', '-e', claimant, dir], {
      encoding: 'utf8',
    });
    expect(blocked.status).not.toBe(0);
    release();
    release();
    const allowed = spawnSync(process.execPath, ['--input-type=module', '-e', claimant, dir], {
      encoding: 'utf8',
    });
    expect(allowed.status, allowed.stderr).toBe(0);
  });
  it('recovers ownership after a process crashes without cleanup', async () => {
    const dir = workspace();
    const child = spawn(process.execPath, ['--input-type=module', '-e', claimant, dir, 'hold'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.stdout!.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Claimant exited early: ${code}`)));
    });
    child.kill('SIGKILL');
    await once(child, 'exit');
    const release = acquireServerLock(dir);
    release();
  });
});
