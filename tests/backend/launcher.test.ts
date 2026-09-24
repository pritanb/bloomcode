import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

let server: Server;
let dir: string;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function launchAgainst(buildId?: string) {
  dir = await mkdtemp(join(tmpdir(), 'tutor-launcher-test-'));
  await mkdir(join(dir, 'scripts'));
  await mkdir(join(dir, 'dist/server'), { recursive: true });
  await copyFile('scripts/launch-local.mjs', join(dir, 'scripts/launch-local.mjs'));
  await copyFile('scripts/runtime.mjs', join(dir, 'scripts/runtime.mjs'));
  await writeFile(join(dir, 'dist/server/build-id'), 'current-build');
  await writeFile(join(dir, 'api-token'), 'disposable-test-token');
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, buildId } : { timezone: 'UTC' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return new Promise<{ code: number; output: string }>(resolve => {
    execFile(process.execPath, [join(dir, 'scripts/launch-local.mjs')], {
      env: { ...process.env, DATA_DIR: dir, PORT: String(address.port), NO_OPEN: '1' },
    }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: stdout + stderr }));
  });
}
it('refuses a healthy legacy server instead of opening incompatible assets', async () => {
  const result = await launchAgainst();
  expect(result.code).toBe(1);
  expect(result.output).toContain('out of date');
});
it('refuses a healthy server from another build', async () => {
  const result = await launchAgainst('older-build');
  expect(result.code).toBe(1);
  expect(result.output).toContain('out of date');
});
it('reuses a healthy matching build', async () => {
  const result = await launchAgainst('current-build');
  expect(result.code).toBe(0);
  expect(result.output).toContain('already running');
});
