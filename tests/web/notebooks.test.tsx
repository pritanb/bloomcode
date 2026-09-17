// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PatternDetail } from '../../src/shared/contracts';
import { api, ApiError } from '../../src/web/api';
import { Patterns } from '../../src/web/Patterns';

const pattern: PatternDetail = { id: 'pattern-1', title: 'Two pointers', recognitionCues: 'Sorted input', pitfalls: 'Off by one', notes: 'Keep the invariant', description: '', archived: false, examples: [], version: 1, updatedAt: '2026-09-16T00:00:00Z' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Patterns /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); focusManager.setFocused(undefined); });

it('recovers unsaved pattern work after navigation and resolves a version conflict without replacing the draft', async () => {
  let saved = { ...pattern };
  vi.spyOn(api, 'get').mockImplementation(async path => (path.startsWith('/patterns?') ? [saved] : saved) as never);
  const send = vi.spyOn(api, 'send').mockImplementation(async (_path, _method, body) => {
    const update = body as Partial<PatternDetail>;
    if (update.version !== saved.version) throw new ApiError(409, 'CONFLICT', 'Version changed');
    saved = { ...saved, ...update, version: saved.version + 1 };
    return saved as never;
  });
  const first = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Two pointers' }));
  fireEvent.change(await screen.findByLabelText('Your notes'), { target: { value: 'Do not lose this lesson' } });
  await waitFor(() => expect(sessionStorage.getItem('leetcode-tutor:pattern-draft:pattern-1')).toContain('Do not lose this lesson'));
  first.unmount();
  saved = { ...saved, version: 2, notes: 'Changed elsewhere' };
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Two pointers' }));
  expect(await screen.findByLabelText('Your notes')).toHaveValue('Do not lose this lesson');
  fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Version changed');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved version, keep my changes' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save pattern' })).toBeEnabled());
  expect(screen.getByLabelText('Your notes')).toHaveValue('Do not lose this lesson');
  fireEvent.click(screen.getByRole('button', { name: 'Save pattern' }));
  await waitFor(() => expect(send).toHaveBeenLastCalledWith('/patterns/pattern-1', 'PATCH', expect.objectContaining({ version: 2, notes: 'Do not lose this lesson' })));
  await waitFor(() => expect(sessionStorage.getItem('leetcode-tutor:pattern-draft:pattern-1')).toBeNull());
});

it('searches notebook contents on the server and hides prior content when a focus refresh is blocked', async () => {
  let blocked = false;
  const get = vi.spyOn(api, 'get').mockImplementation(async () => {
    if (blocked) throw new ApiError(403, 'HIDDEN_ASSESSMENT', 'Complete the mixed assessment first');
    return [pattern] as never;
  });
  mount();
  await screen.findByRole('button', { name: 'Two pointers' });
  fireEvent.change(screen.getByLabelText('Search patterns'), { target: { value: 'Sorted input' } });
  await waitFor(() => expect(get).toHaveBeenCalledWith('/patterns?q=Sorted+input'));
  expect(await screen.findByRole('button', { name: 'Two pointers' })).toBeVisible();
  blocked = true;
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Complete the mixed assessment first');
  expect(screen.queryByRole('button', { name: 'Two pointers' })).not.toBeInTheDocument();
});
