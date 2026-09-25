// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { Attempt } from '../../src/shared/contracts';
import {
  AttemptComparison,
  previousAttempt,
} from '../../src/web/features/practice/AttemptComparison';
import { AttemptReflection } from '../../src/web/features/practice/AttemptReflection';
import { reviewWeek } from '../../src/web/features/reports/ReviewCalendar';
import { api, ApiError } from '../../src/web/app/api';
const attempt: Attempt = {
  id: 'current',
  problemId: 'p1',
  problem: {
    id: 'p1',
    title: 'Question',
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
  },
  planItemId: null,
  status: 'completed',
  version: 1,
  language: 'python',
  code: 'return 42',
  notes: '',
  activeSeconds: null,
  startedAt: '2026-09-16T01:00:00Z',
  finishedAt: '2026-09-16T02:00:00Z',
  studyDate: '2026-09-16',
  runningSince: null,
  lastHeartbeatAt: null,
  needsGapDecision: false,
  outcome: 'solved',
  help: 'none',
  evidence: 'retention',
  confidence: null,
  feedback: null,
  reviewedAt: null,
  nextReviewDate: null,
};
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('compares the historical attempt with its immediate completed predecessor, excluding future and unfinished attempts', () => {
  const previous = { ...attempt, id: 'previous', finishedAt: '2026-09-15T02:00:00Z' };
  const future = { ...attempt, id: 'future', finishedAt: '2026-09-17T02:00:00Z' };
  expect(
    previousAttempt(attempt, [future, { ...previous, id: 'active', status: 'active' }, previous]),
  ).toEqual(previous);
  expect(previousAttempt(previous, [attempt, future])).toBeUndefined();
});

it('does not retrieve previous solutions before completion or before explicit expansion', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ history: [] });
  const cache = client();
  const view = (a: Attempt) => (
    <QueryClientProvider client={cache}>
      <AttemptComparison attempt={a} />
    </QueryClientProvider>
  );
  const mounted = render(view({ ...attempt, status: 'active' }));
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  mounted.rerender(view({ ...attempt, status: 'paused' }));
  expect(get).not.toHaveBeenCalled();
  mounted.rerender(view(attempt));
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Compare with previous attempt' }));
  expect(
    await screen.findByText('This is your first completed attempt for this question.'),
  ).toBeVisible();
  expect(get).toHaveBeenCalledWith('/attempts/current/context');
});

it('preserves a reflection through version conflict and explicitly resaves with the refreshed version', async () => {
  const send = vi
    .spyOn(api, 'send')
    .mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Changed elsewhere'))
    .mockResolvedValue({
      ...attempt,
      version: 3,
      takeaway: 'Check empty input',
      mistakeLabels: [],
    });
  vi.spyOn(api, 'get').mockResolvedValue({ ...attempt, version: 2 });
  function Editor() {
    const [value, setValue] = useState(attempt);
    return <AttemptReflection attempt={value} onSaved={setValue} />;
  }
  render(
    <QueryClientProvider client={client()}>
      <Editor />
      <a href="/">Done for now</a>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Check empty input' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(fireEvent.click(screen.getByRole('link', { name: 'Done for now' }))).toBe(false);
  expect(confirm).toHaveBeenCalledWith(
    'Your reflection has unsaved changes. Leave without saving?',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh attempt version' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Refresh attempt version' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('textbox')).toHaveValue('Check empty input');
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }));
  expect(await screen.findByText('Reflection saved.')).toBeVisible();
  expect(send.mock.calls[1][2]).toEqual({
    version: 2,
    takeaway: 'Check empty input',
    mistakeLabels: [],
  });
});

it('anchors the seven calendar dates in the configured timezone across a daylight-saving change', () => {
  expect(reviewWeek('Australia/Sydney', new Date('2026-10-03T14:30:00Z'))).toEqual([
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
  ]);
});
