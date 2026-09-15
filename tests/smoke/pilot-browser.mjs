// Browser-read-only QA of an explicitly selected pilot, never creates attempts.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.PILOT_URL ?? 'http://127.0.0.1:4317';
const output = process.env.QA_OUTPUT ?? '/tmp/leetcode-tutor-qa';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  for (const [path, name] of [['/', 'dashboard'], ['/library', 'library'], ['/topics', 'topics'], ['/settings', 'settings']]) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    console.log(`${name}: ${await page.locator('h1').innerText()}`);
  }
  await page.goto(`${base}/topics`);
  const link = page.locator('a[href^="/topics/"]').filter({ hasText: 'Binary Search' }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: `${output}/topic-detail.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/library`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: `${output}/mobile-library.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(`Pilot browser QA passed; screenshots ${output}`);
} finally { await browser.close(); }
