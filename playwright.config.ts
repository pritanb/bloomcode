import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright re-evaluates configuration in worker processes. Publish the one
// temporary directory through inherited environment, not a fresh mkdtemp there.
const dataDir = process.env.LEETCODE_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'leetcode-tutor-e2e-'));
process.env.LEETCODE_E2E_DATA_DIR = dataDir;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:4318', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node dist/server/index.js',
    url: 'http://127.0.0.1:4318/health',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: '4318', DATA_DIR: dataDir, NODE_ENV: 'test' },
  },
});
