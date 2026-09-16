// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../../src/web/App';
import { ProblemTable } from '../../src/web/Library';
import { AttemptList } from '../../src/web/ui';
import type { Attempt, Problem } from '../../src/shared/contracts';

afterEach(cleanup);

const problem: Problem = {
  id: 'design-only',
  title: 'A question with a long descriptive title',
  url: 'https://leetcode.com/problems/two-sum/',
  slug: 'two-sum',
  difficulty: 'Easy',
  notes: '',
  tags: [],
  lists: [],
  legacyCompleted: false,
  exposed: false,
  lastAttemptAt: null,
  lastSolveSeconds: null,
  lastSolveHelp: null,
  lastOutcome: null,
  nextReviewDate: null,
  attemptCount: 0,
};

it('gives library and history cells mobile labels without duplicating accessible text', () => {
  const attempt: Attempt = {
    id: 'design-attempt',
    problem,
    status: 'completed',
    outcome: 'solved',
    activeSeconds: null,
    evidence: 'retention',
    help: 'unknown',
    startedAt: '2026-09-16T00:00:00Z',
    finishedAt: null,
    reviewedAt: null,
    problemId: problem.id,
    planItemId: null,
    version: 1,
    language: 'python',
    code: '',
    notes: '',
    studyDate: '2026-09-16',
    runningSince: null,
    lastHeartbeatAt: null,
    needsGapDecision: false,
    confidence: null,
    feedback: null,
    nextReviewDate: null,
  };
  render(
    <MemoryRouter>
      <ProblemTable problems={[problem]} />
      <AttemptList items={[attempt]} />
    </MemoryRouter>,
  );
  const tables = screen.getAllByRole('table');
  expect(tables).toHaveLength(2);
  for (const table of tables) {
    expect(table).toHaveClass('responsive-table');
    const headers = within(table).getAllByRole('columnheader');
    const cells = within(table).getAllByRole('cell');
    expect(cells).toHaveLength(headers.length);
    headers.forEach((header, index) => {
      expect(header).toHaveAttribute('scope', 'col');
      const label = cells[index].querySelector('.cell-label');
      expect(label).toHaveTextContent(header.textContent!);
      expect(label).toHaveAttribute('aria-hidden', 'true');
    });
  }
  expect(screen.getByText('Not attempted')).toBeVisible();
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
});

it('keeps navigation names and routes while using decorative Lucide icons', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/not-a-route']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const nav = screen.getByRole('navigation', { name: 'Main navigation' });
  for (const [name, href] of Object.entries({
    'Study desk': '/',
    'Question library': '/library',
    'Topic progress': '/topics',
    'Settings & data': '/settings',
  })) {
    const link = within(nav).getByRole('link', { name });
    expect(link).toHaveAttribute('href', href);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false');
  }
});

it('provides the Corporate Trust palette through one local token stylesheet', () => {
  const path = 'src/web/tokens.css';
  expect(existsSync(path), 'The shared Corporate Trust tokens must exist').toBe(
    true,
  );
  const tokens = readFileSync(path, 'utf8');
  for (const [name, value] of Object.entries({
    canvas: '#F8FAFC',
    surface: '#FFFFFF',
    primary: '#4F46E5',
    secondary: '#7C3AED',
    text: '#0F172A',
    muted: '#64748B',
    border: '#E2E8F0',
    success: '#10B981',
  })) {
    expect(tokens).toMatch(new RegExp(`--${name}:\\s*${value}`, 'i'));
  }
  expect(tokens).toContain('prefers-color-scheme: dark');
  expect(tokens).toMatch(/['"]Plus Jakarta Sans Variable['"]/);
  const fontAsset =
    '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2';
  expect(tokens).toContain(fontAsset);
  expect(existsSync(`node_modules/${fontAsset}`)).toBe(true);
  expect(tokens).toMatch(/font-weight:\s*200 800/);
  expect(tokens).toMatch(/font-display:\s*swap/);
  const styles = readFileSync('src/web/styles.css', 'utf8');
  expect(styles).toContain("@import './tokens.css'");
  expect(styles).toContain('prefers-reduced-motion: reduce');
  expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
});
