import { test as base, expect, type Page } from '@playwright/test';
import type { Attempt, Problem } from '../../src/shared/contracts';

/** Observe the UI's actual session. Never call /session a second time behind its back. */
export class BrowserApi {
  private csrf: Promise<string> | undefined;
  constructor(private readonly page: Page) {
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/session' && response.ok()) {
        this.csrf = response.json().then((data: { csrfToken: string }) => data.csrfToken);
      }
    });
  }
  async read<T>(path: string): Promise<T> {
    const response = await this.page.request.get(`/api${path}`);
    expect(response.ok(), `GET ${path}: ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  }
  async send<T>(path: string, data: unknown, method: 'POST' | 'PATCH' = 'POST', key?: string): Promise<T> {
    expect(this.csrf, 'The UI must establish a same-origin session before fixture writes').toBeDefined();
    const response = await this.page.request.fetch(`/api${path}`, {
      method, data,
      headers: { 'X-CSRF-Token': await this.csrf!, ...(key ? { 'Idempotency-Key': key } : {}) },
    });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  }
}

export const test = base.extend<{ api: BrowserApi }>({
  api: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const api = new BrowserApi(page);
    await use(api);
    expect(errors, 'No uncaught JavaScript or browser-console errors').toEqual([]);
  },
});
export { expect };

export async function openLibrary(page: Page) {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Question library', exact: true })).toBeVisible();
  await expect(page.locator('.library-results h2')).toBeVisible();
}
export async function createProblem(api: BrowserApi, slug: string, title: string): Promise<Problem> {
  return api.send('/problems', { title, url: `https://leetcode.com/problems/${slug}/`, difficulty: 'Easy' });
}
export async function currentAttempt(page: Page, api: BrowserApi): Promise<Attempt> {
  const id = new URL(page.url()).pathname.split('/').at(-1);
  expect(id).toBeTruthy();
  return api.read(`/attempts/${id}`);
}
export async function startTargeted(page: Page, problem: Problem) {
  await page.goto(`/library/${problem.id}`);
  await page.getByRole('button', { name: 'Start targeted practice', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
}
export async function finish(page: Page, options: { seconds: number | null; review: 'none' | 'manual'; date?: string }) {
  await page.getByRole('button', { name: 'Finish attempt', exact: true }).click();
  await page.getByLabel('Outcome', { exact: true }).selectOption('solved');
  await page.getByLabel('Help used', { exact: true }).selectOption('none');
  if (options.seconds === null) await page.getByLabel('Time unknown', { exact: true }).check();
  else await page.getByLabel('Active time (seconds)', { exact: true }).fill(String(options.seconds));
  await page.getByLabel('Next review', { exact: true }).selectOption(options.review);
  if (options.review === 'manual') await page.getByLabel('Review date', { exact: true }).fill(options.date!);
  await page.getByRole('button', { name: 'Save attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Awaiting tutor review', exact: true })).toBeVisible();
}
