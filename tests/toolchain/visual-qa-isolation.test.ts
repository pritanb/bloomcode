import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test.each(['preview-server.ts','visual-qa.ts'])('%s cannot reuse the live pilot for visual QA', file => {
  const source = readFileSync(`tests/web/${file}`,'utf8');
  expect(source).toMatch(/port:\s*0\b/);
  expect(source).toContain('mkdtempSync');
  expect(source).not.toContain('4317');
  expect(source).not.toContain('process.env.QA_URL');
});
