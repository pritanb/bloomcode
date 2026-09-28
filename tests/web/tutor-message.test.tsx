// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { TutorMessage } from '../../src/web/features/tutor/TutorMessage';

const id = '12345678-1234-1234-1234-123456789abc';
const unknown = '87654321-1234-1234-1234-123456789abc';
const evidence = [{ id, title: 'Implement Queue using Stacks' }];
afterEach(cleanup);
function show(text: string) {
  return render(
    <MemoryRouter>
      <TutorMessage text={text} evidence={evidence} />
    </MemoryRouter>,
  );
}

it('renders the reported citation and italic formatting without exposing Markdown syntax', () => {
  const { container } = show(
    `**Next:** review [queue using stacks](#attempt/${id}).\n\n*Which days are waiting?*\n\n- Trace the stack\n- Compare your result`,
  );
  expect(screen.getByRole('link', { name: 'queue using stacks' })).toHaveAttribute(
    'href',
    `/attempts/${id}`,
  );
  expect(container.querySelector('strong')).toHaveTextContent('Next:');
  expect(container.querySelector('em')).toHaveTextContent('Which days are waiting?');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(container).not.toHaveTextContent('#attempt/');
});

it('links verified bare IDs but leaves code and unsupported records alone', () => {
  const { container } = show(
    `${id}\n\n\`\`\`python\nrecord = "${id}"\n\`\`\`\n\n[unknown](#attempt/${unknown}) [internal](/settings)`,
  );
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link')).toHaveTextContent(evidence[0].title);
  expect(container.querySelector('pre code')).toHaveTextContent(id);
  expect(container.querySelector('pre a')).toBeNull();
});

it('does not execute HTML, unsafe links or load model-supplied images', () => {
  const { container } = show(
    '[bad](javascript:alert%281%29) ![diagram](https://example.com/track.png) <script>alert(1)</script>\n\n[reference](https://example.com)',
  );
  expect(container.querySelector('script, img')).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'reference' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
});
