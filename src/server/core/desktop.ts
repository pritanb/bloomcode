import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolveDataDir } from '../../../scripts/runtime.mjs';
import { acquireServerLock } from '../../../scripts/server-lock.mjs';
import { createApp } from './app.js';

// Electron utility processes expose a narrow parent messaging port, not renderer IPC.
const parent = (
  process as typeof process & {
    parentPort?: {
      postMessage(message: unknown): void;
      on(event: 'message', listener: (event: { data: unknown }) => void): void;
    };
  }
).parentPort;
if (!parent) throw new Error('The desktop backend must be launched by the desktop app.');
const dataDir = resolveDataDir();
const port = Number(process.env.PORT ?? 4317);
let backend: Awaited<ReturnType<typeof createApp>> | undefined;
let release: (() => void) | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await backend?.close();
  } finally {
    release?.();
    process.exit(0);
  }
}
parent.on('message', (event) => {
  if ((event.data as { type?: string })?.type === 'shutdown') void stop();
});
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
// A crashed desktop process must not leave a background writer behind.
const parentPid = Number(process.env.TUTOR_DESKTOP_PARENT_PID);
if (Number.isSafeInteger(parentPid) && parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') void stop();
    }
  }, 1000).unref();
}

try {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('The app port must be between 0 and 65535.');
  // Legacy launchers predate the workspace lock. Never open their database concurrently.
  let previousPid = 0;
  try {
    previousPid = Number(readFileSync(join(dataDir, 'server.pid'), 'utf8').trim());
  } catch {
    /* No legacy launch. */
  }
  if (Number.isSafeInteger(previousPid) && previousPid > 0 && previousPid !== process.pid) {
    let alive = true;
    try {
      process.kill(previousPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive)
      throw new Error(
        'A previous local server is still running. Quit it before opening the desktop app; your study data has not been changed.',
      );
  }
  release = acquireServerLock(dataDir);
  // Check the fixed port before any database write.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Error(
          'Another application or local server is using the app port. Close that server and retry.',
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
  if (stopping) throw new Error('Desktop startup was cancelled.');
  backend = await createApp({
    dbPath: join(dataDir, 'leetcode.sqlite'),
    serveStatic: process.env.TUTOR_WEB_ROOT || true,
    followSystemTimezone: true,
    dailyBackup: true,
  });
  if (stopping) throw new Error('Desktop startup was cancelled.');
  const address = await backend.listen({ host: '127.0.0.1', port });
  parent.postMessage({ type: 'ready', address });
} catch (error) {
  parent.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'The local study server could not start.',
  });
  await backend?.close();
  release?.();
  process.exit(1);
}
