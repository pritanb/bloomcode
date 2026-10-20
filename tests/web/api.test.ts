import { afterEach, expect, it, vi } from 'vitest';
import { createApi } from '../../src/web/app/api';
afterEach(() => vi.unstubAllGlobals());
it('initialises one browser session before concurrent reads and includes CSRF on writes', async () => {
  const fetcher = vi.fn(
    async (path: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          path === '/api/session' ? { csrfToken: 'test-csrf' } : { path, method: init?.method },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const api = createApi();
  await Promise.all([api.get('/tags'), api.get('/lists')]);
  await api.send('/problems', 'POST', { title: 'Example' });
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/session')).toHaveLength(1);
  expect(fetcher.mock.calls[3]).toEqual([
    '/api/problems',
    expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf' }),
      body: '{"title":"Example"}',
    }),
  ]);
});
it('renews an expired session once and replays the request with the new CSRF token', async () => {
  let sessions = 0;
  let validCsrf = '';
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/session') {
      validCsrf = `csrf-${++sessions}`;
      return new Response(JSON.stringify({ csrfToken: validCsrf }), { status: 200 });
    }
    const csrf = (init?.headers as Record<string, string>)['X-CSRF-Token'];
    if (path === '/api/locked' || csrf !== validCsrf || sessions === 1)
      return new Response(
        JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
        { status: 401 },
      );
    return new Response(JSON.stringify({ csrf }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetcher);
  const api = createApi();
  const results = await Promise.all([
    api.send('/attempts/a', 'PATCH', { notes: 'x' }),
    api.send('/attempts/b', 'PATCH', { notes: 'y' }),
  ]);
  expect(results).toEqual([{ csrf: 'csrf-2' }, { csrf: 'csrf-2' }]);
  expect(sessions).toBe(2);
  await expect(api.get('/locked')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/locked')).toHaveLength(2);
});
