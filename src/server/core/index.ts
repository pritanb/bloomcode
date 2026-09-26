import { resolveDataDir } from '../../../scripts/runtime.mjs';
import { acquireServerLock } from '../../../scripts/server-lock.mjs';
import { join } from 'node:path';
import { createApp } from './app.js';
const dataDir = resolveDataDir();
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('PORT must be an integer between 0 and 65535');
const release = await acquireServerLock(dataDir);
try {
  const app = await createApp({
    dbPath: join(dataDir, 'leetcode.sqlite'),
    serveStatic: true,
    followSystemTimezone: true,
    dailyBackup: true,
  });
  app.addHook('onClose', async () => {
    await release();
  });
  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    console.log(`BloomCode listening at ${address}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  await release();
  throw error;
}
