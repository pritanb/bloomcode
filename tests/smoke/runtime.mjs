import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

for (const entry of ['dist/server/index.js', 'dist/server/mcp.js', 'dist/web/index.html']) {
  assert.ok(existsSync(entry), `Build must produce the documented runtime entry ${entry}`);
}
const dir = mkdtempSync(join(tmpdir(), 'tutor-production-smoke-'));
const child = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, DATA_DIR: dir, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});
try {
  const deadline = Date.now() + 15000;
  while (!output.includes('listening at ') && child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const address = output.match(/listening at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  assert.ok(address, `Built server must start with real SQLite migrations: ${output}`);
  const health = await fetch(`${address}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).buildId, readFileSync('dist/server/build-id', 'utf8').trim());
  const launch = await promisify(execFile)(process.execPath, ['scripts/launch-local.mjs'], {
    env: { ...process.env, DATA_DIR: dir, PORT: new URL(address).port, NO_OPEN: '1' },
  });
  assert.match(launch.stdout, /already running/);
  const page = await fetch(`${address}/library`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root"><\/div>/);
  const session = await fetch(`${address}/api/session`);
  const cookie = session.headers.getSetCookie()[0].split(';')[0];
  const settings = await fetch(`${address}/api/settings`, { headers: { cookie } });
  assert.equal(settings.status, 200);
  assert.equal(typeof (await settings.json()).timezone, 'string');
  assert.equal((await fetch(`${address}/api/settings`)).status, 401);
  console.log(
    'Production smoke passed: flat entrypoints, SQLite migration, build identity, launcher reuse, SPA deep link, authenticated settings and anonymous rejection.',
  );
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  rmSync(dir, { recursive: true, force: true });
}
