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
