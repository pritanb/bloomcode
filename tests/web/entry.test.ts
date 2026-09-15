import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
it('boots the real React entrypoint with responsive viewport and a named document',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  expect(html).toContain('name="viewport"');expect(html).toContain('<title>LeetCode Tutor</title>');expect(html).toContain('src="/src/web/main.tsx"');
  const entry=readFileSync(new URL('../../src/web/main.tsx',import.meta.url),'utf8');
  expect(entry).toContain('QueryClientProvider');expect(entry).toContain('BrowserRouter');expect(entry).toContain('./styles.css');
});
