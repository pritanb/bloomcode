import { chromium, type Browser } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app';

// Own both the database and listener. Never accept or infer another server URL.
const dir = mkdtempSync(join(tmpdir(), 'leetcode-visual-qa-'));
const app = await createApp({ dbPath: join(dir, 'qa.sqlite'), serveStatic: true });
let browser: Browser | undefined;
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(address);
  const title = page.getByRole('heading', { name: 'Your study desk' });
  await title.waitFor();
  assert.ok((await title.boundingBox())!.y < 90, 'Dashboard should start near the top');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/library', '/topics', '/settings']) {
      await page.goto(`${address}${path}`);
      await page.locator('h1').waitFor();
      await page.locator('.loading').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        `No horizontal overflow at ${width} on ${path}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Owned disposable visual QA: 12 responsive route layouts and zero browser exceptions verified.');
} finally {
  try { await browser?.close(); }
  finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
