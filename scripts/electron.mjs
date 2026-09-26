import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const stage = join(root, 'dist/electron-stage');
const [mode = 'dev', ...flags] = process.argv.slice(2);
if (!['dev', 'package', 'make'].includes(mode)) throw new Error('Choose dev, package or make.');
if (process.platform !== 'darwin')
  throw new Error('Desktop packaging currently supports macOS only.');
const command = mode === 'dev' ? 'start' : mode;
await access(join(root, 'dist/server/desktop.js'));
await access(join(root, 'dist/web/index.html'));
await mkdir(stage, { recursive: true });

// Keep Electron's native-module rebuild completely separate from the browser app.
// Copy only distributable resources, never .env, user data, or the full checkout.
for (const [source, target] of [
  ['desktop/electron', 'electron'],
  ['desktop/assets/icon.icns', 'assets/icon.icns'],
  ['dist/server', 'dist/server'],
  ['dist/web', 'dist/web'],
  ['src/integrations/manifests', 'src/integrations/manifests'],
  ['scripts/runtime.mjs', 'scripts/runtime.mjs'],
  ['desktop/package.json', 'package.json'],
  ['desktop/package-lock.json', 'package-lock.json'],
  ['desktop/forge.config.cjs', 'forge.config.cjs'],
]) {
  const destination = join(stage, target);
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, source), destination, { recursive: true });
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: stage, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${executable} exited with ${signal ?? code}`)),
    );
  });
}

const lockHash = createHash('sha256')
  .update(await readFile(join(stage, 'package-lock.json')))
  .digest('hex');
const marker = join(stage, '.installed-lock');
let installed;
try {
  installed = (await readFile(marker, 'utf8')) === lockHash;
  // Recent Electron versions fetch their development binary lazily on first start.
  await access(join(stage, 'node_modules/electron/package.json'));
  await access(join(stage, 'node_modules/.bin/electron-forge'));
} catch {
  installed = false;
}
if (!installed) {
  await run('npm', ['ci', '--no-audit', '--no-fund']);
  await writeFile(marker, lockHash);
}
let devServer;
try {
  if (mode === 'dev') {
    const { createServer } = await import('vite');
    // Match the backend port while keeping Vite's existing Origin/CSRF proxy checks.
    process.env.TUTOR_DEV_API_PORT = process.env.DESKTOP_TEST_PORT || process.env.PORT || '4317';
    devServer = await createServer({
      root,
      server: { host: '127.0.0.1', port: 5173, strictPort: true },
    });
    await devServer.listen();
    process.env.TUTOR_DEV_RENDERER_URL = 'http://127.0.0.1:5173';
    console.log(
      'Desktop development: UI changes update live. Restart this command for backend or Electron changes.',
    );
  }
  await run(join(stage, 'node_modules/.bin/electron-forge'), [command, ...flags]);
} finally {
  await devServer?.close();
}
