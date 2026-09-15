import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../../playwright.config.js';
const exec = promisify(execFile);

test('Playwright worker config inherits the exact disposable server data directory', async () => {
  const server = config.webServer;
  if (!server || Array.isArray(server)) throw new Error('Expected one configured test server');
  const child = await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    'import config from "./playwright.config.ts"; console.log(config.webServer.env.DATA_DIR);',
  ], { env: { ...process.env } });
  expect(child.stdout.trim()).toBe(server.env?.DATA_DIR);
});
