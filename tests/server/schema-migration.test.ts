import { afterEach, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { FIXTURE_CLOCK, readEndpoints } from './fixtures/schema-fixture-reads.js';

// schema-v3.sqlite was written by the JSON-column code (see fixtures/build-schema-fixture.ts).
// Opening it migrates it; every read must return what the old code returned.
const fixtures = new URL('./fixtures/', import.meta.url).pathname;
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('migrated study data reads back exactly as before', async () => {
  dir = mkdtempSync(join(tmpdir(), 'lc-schema-'));
  const dbPath = join(dir, 'fixture.sqlite');
  copyFileSync(join(fixtures, 'schema-v3.sqlite'), dbPath);
  // Intended change: review targets no longer carry `constraint`, which was always null.
  const expected = JSON.parse(
    readFileSync(join(fixtures, 'schema-v3-responses.json'), 'utf8'),
    (key, value) => (key === 'constraint' ? undefined : value),
  );
  const app = await createApp({ dbPath, token: 't', clock: () => FIXTURE_CLOCK });
  const get = async (url: string) =>
    (await app.inject({ url, headers: { authorization: 'Bearer t' } })).json();
  try {
    const urls = await readEndpoints(get);
    expect(urls.sort()).toEqual(Object.keys(expected).sort());
    for (const url of urls)
      expect({ url, body: await get(url) }).toEqual({ url, body: expected[url] });
  } finally {
    await app.close();
  }
}, 60_000);
