import { expect, test } from '@playwright/test';

test('an older dashboard response gives restart instructions, not a blank screen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Same dashboard shape as the pre-study-workspace backend. All actual
  // requests use the disposable server owned by playwright.config.ts.
  await page.route('**/api/dashboard', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.activity;
    delete data.latestReflection;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await expect(
    page.getByText('The local server is out of date. Stop it and launch LeetCode Tutor again.'),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a matching server renders the study desk', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Completed attempts by study day' })).toBeVisible();
  expect(errors).toEqual([]);
});
