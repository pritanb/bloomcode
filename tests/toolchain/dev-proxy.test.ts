import { expect, test } from 'vitest';
import { createServer, type ProxyOptions } from 'vite';
import { createApp } from '../../src/server/app.js';
import config from '../../vite.config.js';

test('Vite forwards legitimate same-origin mutations without accepting foreign origins', async () => {
  const app = await createApp({ dbPath: ':memory:' });
  const upstream = await app.listen({ host: '127.0.0.1', port: 0 });
  const proxy = Object.fromEntries(
    Object.entries(config.server!.proxy!).map(([path, options]) => [
      path,
      {
        ...(typeof options === 'string' ? {} : options),
        target: upstream,
      } satisfies ProxyOptions,
    ]),
  );
  const vite = await createServer({
    ...config,
    configFile: false,
    server: { ...config.server, port: 0, proxy },
  });
  try {
    await vite.listen();
    const address = vite.httpServer!.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const session = await fetch(`${origin}/api/session`);
    expect(session.status).toBe(200);
    const cookie = session.headers.getSetCookie()[0].split(';')[0];
    const { csrfToken } = (await session.json()) as { csrfToken: string };
    const create = (requestOrigin: string) =>
      fetch(`${origin}/api/tags`, {
        method: 'POST',
        headers: {
          origin: requestOrigin,
          cookie,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ name: 'Proxy regression' }),
      });
    const valid = await create(origin);
    expect(valid.status, await valid.text()).toBe(200);
    const foreign = await create('https://untrusted.example');
    expect(foreign.status).toBe(403);
  } finally {
    await vite.close();
    await app.close();
  }
});
