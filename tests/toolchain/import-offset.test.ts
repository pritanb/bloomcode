import { expect, test } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { mapSheetSnapshot } from '../../src/integrations/sheet.js';

test.each(['2026-09-16T00:00:00Z', '2026-09-16T00:00:00.123456+00:00', '2026-09-16T10:00:00+10:00'])(
  'imports a valid timestamp without changing its original provenance: %s', async retrievedAt => {
    const app = await createApp({ dbPath: ':memory:', token: 'test-only-import-offset' });
    try {
      const mapped = mapSheetSnapshot({ retrievedAt, sheets: [{ title: 'Topic Ratings', values: [['Topic', 'Rating (1-5)'], ['Trees', 3.5]] }] });
      const headers = { host: 'localhost', authorization: 'Bearer test-only-import-offset' };
      const result = await app.inject({ method: 'POST', url: '/api/import', headers, payload: { ...mapped.payload, dryRun: false } });
      expect(result.statusCode, result.body).toBe(200);
      const exported = await app.inject({ method: 'GET', url: '/api/export', headers });
      expect(exported.json().tables.import_batches[0].source.retrievedAt).toBe(retrievedAt);
    } finally { await app.close(); }
  },
);
