// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { InsightText } from '../../src/web/features/insights/InsightText';

afterEach(cleanup);
it('renders old report citations as verified links and supports formatted practice text', () => {
  const hash = 'a'.repeat(64);
  const unknown = 'b'.repeat(64);
  const attemptId = '12345678-1234-1234-1234-123456789abc';
  const { container } = render(
    <MemoryRouter>
      <InsightText
        text={`**Check the invariant.** [${hash}]\n\n- Trace two elements\n- Explain termination\n\n${unknown}`}
        sources={[{ id: hash, attemptId, problemTitle: 'Binary Search' }]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'source 1' })).toHaveAttribute(
    'href',
    `/attempts/${attemptId}`,
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(container.querySelector('strong')).toHaveTextContent('Check the invariant.');
  expect(container.textContent).not.toContain(hash);
  expect(container.textContent).not.toContain(unknown);
  expect(screen.getAllByRole('link')).toHaveLength(1);
});
