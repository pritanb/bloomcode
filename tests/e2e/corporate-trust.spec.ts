import { test as base, expect, type Page } from '@playwright/test';
import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, finish } from './helpers';
import type { Attempt, ImportPayload, ImportReport, ProblemPage, Topic } from '../../src/shared/contracts';

// Never use the shared journeys server/database for visual fixtures. The normal
// Playwright config still owns its disposable 4318 server (reuse=false); this
// file serves the SAME dist/web assets through a private port-0 SQLite instance.
const test = base.extend<{ isolatedPage: Page }>({
  isolatedPage: async ({ browser }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'leetcode-corporate-trust-'));
    const child = fork(join(process.cwd(), 'tests/web/api-server.ts'), [dir, '--static'], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, DATA_DIR: dir, NODE_ENV: 'test' },
    });
    let stderr = '';
    child.stderr?.on('data', data => { stderr += String(data); });
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Isolated server startup timed out: ${stderr}`)), 15_000);
        child.once('message', message => { clearTimeout(timeout); resolve((message as { address: string }).address); });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Isolated server exited ${code}: ${stderr}`)); });
      });
      expect(new URL(address).port).not.toBe('4317');
      expect(new URL(address).port).not.toBe('4318');
      context = await browser.newContext({ baseURL: address, viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
      await use(await context.newPage());
    } finally {
      await context?.close();
      if (child.connected) child.send('close');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3_000);
      await exited;
      clearTimeout(kill);
      await rm(dir, { recursive: true, force: true });
    }
  },
});

const fixtureTitle = 'Corporate Trust QA · Two Sum';
const fixtureTopic = 'Corporate Trust QA · Hash maps';
const fixtureCode = 'def two_sum(nums, target):\n    return []';
const modes = [
  { name: 'desktop-light', width: 1440, height: 1000, scheme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 1000, scheme: 'dark' },
  { name: 'mobile-light', width: 375, height: 812, scheme: 'light' },
  { name: 'mobile-dark', width: 375, height: 812, scheme: 'dark' },
] as const;

async function seed(page: Page) {
  // The fixed token belongs ONLY to tests/web/api-server.ts. No vault, source
  // database, shared fixture, importFixture helper, or restore endpoint is used.
  const headers = { Authorization: 'Bearer isolated-test-token' };
  const payload: ImportPayload = {
    importId: 'corporate-trust-visual-contract', dryRun: false,
    source: { retrievedAt: '2026-09-01T12:00:00.000Z' },
    problems: [{ key: 'qa-two-sum', title: fixtureTitle, url: 'https://leetcode.com/problems/two-sum/', difficulty: 'Easy', tags: [fixtureTopic], lists: ['Corporate Trust QA collection'], notes: 'Independent visual fixture; never real study data.' }],
    topics: [{ name: fixtureTopic, score: 3.25, provisional: true, notes: 'Evidence-based visual fixture.' }],
    attempts: [{ sourceKey: 'qa-history', problemKey: 'qa-two-sum', date: '2026-09-01', outcome: 'solved', help: 'none', activeSeconds: 625, notes: 'Saved QA history', code: fixtureCode, evidence: 'retention', topicNames: [fixtureTopic] }],
    movements: [{ sourceKey: 'qa-movement', topicName: fixtureTopic, problemKey: 'qa-two-sum', date: '2026-09-01', oldScore: 3, newScore: 3.25, rationale: 'Independent visual fixture rationale.', evidence: 'unseen' }],
    planned: [], records: [],
  };
  const imported = await page.request.post('/api/import', { headers, data: payload });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  expect((await imported.json() as ImportReport).unresolved).toEqual([]);
  const problems = await page.request.get('/api/problems', { headers });
  const topics = await page.request.get('/api/topics', { headers });
  expect(problems.ok()).toBeTruthy(); expect(topics.ok()).toBeTruthy();
  const problem = (await problems.json() as ProblemPage).items.find(item => item.title === fixtureTitle)!;
  const topic = (await topics.json() as Topic[]).find(item => item.name === fixtureTopic)!;
  expect(problem).toBeDefined(); expect(topic).toBeDefined();
  const started = await page.request.post('/api/attempts', { headers, data: { problemId: problem.id, context: 'targeted' } });
  expect(started.ok(), await started.text()).toBeTruthy();
  const attempt = await started.json() as Attempt;
  const drafted = await page.request.patch(`/api/attempts/${attempt.id}/draft`, { headers, data: { version: attempt.version, code: fixtureCode } });
  expect(drafted.ok(), await drafted.text()).toBeTruthy();
  return { problem, topic, attempt };
}

/** Computed-style checks complement retained screenshots; not a full WCAG audit.
 * Alpha backgrounds are composited, gradient buttons use their WORST stop, and
 * checkbox labels count as their actual clickable target, not the tiny glyph.
 */
async function audit(page: Page) {
  return page.evaluate(() => {
    type RGB = [number, number, number, number];
    const rgba = (value: string): RGB => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const over = (top: RGB, bottom: RGB): RGB => [
      top[0] * top[3] + bottom[0] * (1 - top[3]),
      top[1] * top[3] + bottom[1] * (1 - top[3]),
      top[2] * top[3] + bottom[2] * (1 - top[3]), 1,
    ];
    const lum = (rgb: RGB) => rgb.slice(0, 3).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (a: RGB, b: RGB) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0 && !element.closest('[aria-hidden="true"], .cm-announced');
    };
    const label = (element: Element) => `${element.tagName.toLowerCase()}.${element.className} ${(element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 85)}`;
    const background = (element: Element): RGB => {
      const chain: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) chain.unshift(current);
      return chain.reduce((color, current) => over(rgba(getComputedStyle(current).backgroundColor), color), [255, 255, 255, 1] as RGB);
    };
    const interactive = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"]')].filter(visible);
    const undersized = interactive.filter(element => !element.matches(':disabled')).flatMap(element => {
      const target = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.labels?.[0] ?? element : element;
      const rect = target.getBoundingClientRect();
      return rect.width + 0.5 < 44 || rect.height + 0.5 < 44 ? [{ element: label(element), width: rect.width, height: rect.height }] : [];
    });
    const scrollContainers = [...document.querySelectorAll('body *')].filter(visible).filter(element => {
      const style = getComputedStyle(element);
      return ['auto', 'scroll'].includes(style.overflowX) && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
    }).map(element => ({ element: label(element), width: element.clientWidth, content: element.scrollWidth }));
    const clipped = [...document.querySelectorAll('main h1,main h2,main p,main table,main a,main button,main input,main select,main textarea,main label')].filter(visible).filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(label);
    const samples = [...document.querySelectorAll('h1,h2,h3,p,small,.muted,.badge,.positive,.negative,label,th,td,a,button,summary')].filter(visible).filter(element => {
      // Sample real rendered text, not a large parent whose children override color.
      return !element.matches(':disabled') && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    }).map(element => {
      const style = getComputedStyle(element);
      const bg = background(element);
      const foreground = rgba(style.color);
      const stops = style.backgroundImage.match(/rgba?\([^)]+\)/g)?.map(rgba) ?? [];
      const backgrounds = style.backgroundImage.includes('gradient') && style.backgroundClip !== 'text' && stops.length ? stops.map(stop => over(stop, bg)) : [bg];
      const textColors = style.backgroundClip === 'text' && stops.length ? stops : [foreground];
      const value = Math.min(...backgrounds.flatMap(color => textColors.map(text => ratio(over(text, color), color))));
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
      return { element: label(element), contrast: Number(value.toFixed(3)), required: large ? 3 : 4.5 };
    });
    const root = getComputedStyle(document.documentElement);
    const tokens = Array.from(root).filter(name => name.startsWith('--')).map(name => `${name}:${root.getPropertyValue(name).trim().toLowerCase()}`);
    return { font: getComputedStyle(document.body).fontFamily, canvas: background(document.body), canvasLuminance: lum(background(document.body)), tokens,
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth, undersized, scrollContainers, clipped,
      samples, lowContrast: samples.filter(sample => sample.contrast + 0.01 < sample.required) };
  });
}

async function keyboardFocus(page: Page) {
  // Exercise actual Tab transitions, not just locator.focus(). Sample each
  // available control category, including links and native form controls.
  for (const selector of ['a[href]', 'button:enabled', 'input:enabled:not([type="hidden"])', 'select:enabled', 'textarea', 'summary']) {
    const candidates = page.locator(selector);
    for (let index = 0; index < await candidates.count(); index++) {
      const target = candidates.nth(index);
      if (!await target.isVisible()) continue;
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target, `${selector} reachable using Tab`).toBeFocused();
      const state = await target.evaluate(element => {
        const style = getComputedStyle(element);
        const transparent = (color: string) => color === 'transparent' || /rgba\([^)]*,\s*0\)/.test(color);
        return { visible: element.matches(':focus-visible'), ring: (parseFloat(style.outlineWidth) >= 2 && !['none', 'hidden'].includes(style.outlineStyle) && !transparent(style.outlineColor)) || (style.boxShadow !== 'none' && !transparent(style.boxShadow)) };
      });
      expect.soft(state.visible, `${selector} uses keyboard focus-visible`).toBeTruthy();
      expect.soft(state.ring, `${selector} has a visible outline or focus ring`).toBeTruthy();
      break;
    }
  }
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => scrollTo(0, 0));
}

async function editorTheme(page: Page, scheme: 'light' | 'dark') {
  // CodeMirror generates opaque class names: test its rendered palette instead.
  await expect.poll(async () => page.locator('.cm-editor').evaluate((element, dark) => {
    const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    if (channels.length < 3 || (channels[3] ?? 1) < 0.95) return false;
    const brightness = (channels[0] + channels[1] + channels[2]) / 3;
    return dark ? brightness < 100 : brightness > 180;
  }, scheme === 'dark'), { message: `CodeMirror renders an opaque ${scheme} background` }).toBeTruthy();
}

async function verifyDesign(page: Page, info: Parameters<typeof capture>[1], name: string, scheme: 'light' | 'dark') {
  await page.evaluate(() => document.fonts.ready);
  const report = await audit(page);
  await info.attach(`${name}-computed-audit`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  // Capture before any assertion, including RED, so every route has evidence.
  await capture(page, info, name);
  expect.soft(report.font, 'Locally bundled Corporate Trust typography').toContain('Plus Jakarta Sans');
  if (scheme === 'light') {
    expect.soft(report.canvas.slice(0, 3), 'Slate-50 canvas').toEqual([248, 250, 252]);
    expect.soft(report.tokens.join(';'), 'Central indigo token').toMatch(/#4f46e5|rgb\(79,\s*70,\s*229\)/);
    expect.soft(report.tokens.join(';'), 'Central violet token').toMatch(/#7c3aed|rgb\(124,\s*58,\s*237\)/);
  } else expect.soft(report.canvasLuminance, 'Dark mode must stay dark').toBeLessThan(0.08);
  expect.soft(report.scrollWidth, 'Document requires no sideways scrolling').toBeLessThanOrEqual(report.width + 1);
  expect.soft(report.scrollContainers, 'Tables, navigation and panels must not require horizontal scrolling either').toEqual([]);
  expect.soft(report.clipped, 'Meaningful content fits the viewport, not merely overflow:hidden').toEqual([]);
  expect.soft(report.undersized, 'All visible controls have 44×44px clickable targets').toEqual([]);
  expect.soft(report.samples.length, 'Contrast assertions must sample rendered text').toBeGreaterThan(0);
  expect.soft(report.lowContrast, 'Rendered text samples meet WCAG AA').toEqual([]);
  await keyboardFocus(page);
}

const routes = ['desk', 'library', 'manage', 'problem', 'topics', 'topic', 'settings', 'attempt', 'not-found'] as const;
for (const mode of modes) {
  for (const route of routes) {
    test(`Corporate Trust ${mode.name} / ${route}`, async ({ isolatedPage: page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const fixture = await seed(page);
      await page.setViewportSize({ width: mode.width, height: mode.height });
      await page.emulateMedia({ colorScheme: mode.scheme });
      const destinations = {
        desk: ['/', 'Your study desk'], library: ['/library', 'Question library'],
        manage: ['/library/manage', 'Tags & lists'], problem: [`/library/${fixture.problem.id}`, fixtureTitle],
        topics: ['/topics', 'Topic progress'], topic: [`/topics/${fixture.topic.id}`, fixtureTopic],
        settings: ['/settings', 'Settings & data'], attempt: [`/attempts/${fixture.attempt.id}`, fixtureTitle],
        'not-found': ['/corporate-trust-unknown-route', ''],
      };
      const [path, heading] = destinations[route];
      await page.goto(path);
      if (heading) await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      else await expect(page.getByText('Page not found.', { exact: true })).toBeVisible();
      if (route === 'library') await expect(page.getByRole('link', { name: fixtureTitle, exact: true })).toBeVisible();
      if (route === 'topics' || route === 'desk') await expect(page.locator(`a[href="/topics/${fixture.topic.id}"]`).first()).toBeVisible();
      if (route === 'manage') await expect(page.getByLabel(`Name for ${fixtureTopic}`, { exact: true })).toBeVisible();
      if (route === 'attempt') {
        await expect(page.locator('.cm-content')).toContainText(fixtureCode);
        await expect(page.getByRole('navigation')).toHaveCount(0);
        await editorTheme(page, mode.scheme);
      }
      await verifyDesign(page, info, `${route}-${mode.name}`, mode.scheme);
      expect.soft(errors, 'No runtime or console errors on any route').toEqual([]);
    });
  }

  test(`Corporate Trust ${mode.name} / attempt closeout and completed states`, async ({ isolatedPage: page }, info) => {
    const fixture = await seed(page);
    await page.setViewportSize({ width: mode.width, height: mode.height });
    await page.emulateMedia({ colorScheme: mode.scheme });
    await page.goto(`/attempts/${fixture.attempt.id}`);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Finish attempt', exact: true }).click();
    await expect(page.getByLabel('Outcome', { exact: true })).toBeVisible();
    await verifyDesign(page, info, `finish-form-${mode.name}`, mode.scheme);
    await page.getByRole('button', { name: 'Back to draft', exact: true }).click();
    await finish(page, { seconds: 625, review: 'none' });
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await verifyDesign(page, info, `completed-${mode.name}`, mode.scheme);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Awaiting tutor review', exact: true })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText(fixtureCode);
  });
}

test('Corporate Trust local font delivery, signature gradient and live editor theme', async ({ isolatedPage: page }, info) => {
  const fontResponses: string[] = [];
  const remoteFonts: string[] = [];
  page.on('request', request => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) remoteFonts.push(request.url()); });
  page.on('response', response => { if (response.request().resourceType() === 'font' && response.ok()) fontResponses.push(response.url()); });
  const fixture = await seed(page);
  await page.goto(`/attempts/${fixture.attempt.id}`);
  await expect(page.locator('.cm-content')).toContainText(fixtureCode);
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    loaded: Array.from(document.fonts).filter(font => /Plus Jakarta Sans/i.test(font.family) && font.status === 'loaded').map(font => font.family),
    checked: document.fonts.check(`16px ${getComputedStyle(document.body).fontFamily.split(',')[0]}`),
  }));
  await capture(page, info, 'corporate-trust-local-font-light');
  expect.soft(fonts.font).toContain('Plus Jakarta Sans');
  expect.soft(fonts.loaded.length, 'An actual Jakarta FontFace loaded; check() alone permits fallback').toBeGreaterThan(0);
  expect.soft(fonts.checked).toBeTruthy();
  expect.soft(fontResponses.length, 'Real local font network response').toBeGreaterThan(0);
  expect.soft(fontResponses.every(url => new URL(url).origin === new URL(page.url()).origin)).toBeTruthy();
  expect.soft(remoteFonts, 'No Google Fonts runtime dependency').toEqual([]);
  const primary = page.getByRole('button', { name: 'Finish attempt', exact: true });
  const gradient = await primary.evaluate(element => getComputedStyle(element).backgroundImage);
  expect.soft(gradient, 'Primary CTA uses the indigo-to-violet signature').toMatch(/linear-gradient/);
  expect.soft(gradient).toContain('rgb(79, 70, 229)');
  expect.soft(gradient).toContain('rgb(124, 58, 237)');
  await editorTheme(page, 'light');
  const light = await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await editorTheme(page, 'dark');
  const dark = await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).backgroundColor);
  expect(dark, 'Editor changes actual background, not just a class').not.toBe(light);
  await page.emulateMedia({ colorScheme: 'light' });
  await editorTheme(page, 'light');
  await expect(page.locator('.cm-content')).toContainText(fixtureCode);
});
