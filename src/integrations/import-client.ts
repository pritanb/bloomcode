import { isDeepStrictEqual } from 'node:util';
import type { ImportPayload } from '../shared/contracts.js';
import { LocalApi } from './local-api.js';
import { snapshotSchema } from './snapshot.js';
export async function applyAndVerify(api: LocalApi, payload: ImportPayload) {
  const report = await api.request('POST', '/api/import', { ...payload, dryRun: false });
  const snapshot = snapshotSchema.parse(await api.request('GET', '/api/export'));
  const decode = (row: Record<string, unknown>): Record<string, unknown> =>
    typeof row.data === 'string'
      ? JSON.parse(row.data)
      : row.data && typeof row.data === 'object'
        ? (row.data as Record<string, unknown>)
        : row;
  const batches = (snapshot.tables.import_batches ?? []).map(decode);
  const records = (snapshot.tables.import_records ?? [])
    .map(decode)
    .filter((r) => r.importId === payload.importId);
  if (
    !batches.some((r) => r.id === payload.importId) ||
    !payload.records.every((expected) =>
      records.some(
        (actual) =>
          actual.sourceKey === expected.sourceKey &&
          actual.tab === expected.tab &&
          actual.row === expected.row &&
          isDeepStrictEqual(actual.raw, expected.raw),
      ),
    )
  )
    throw Error(
      'IMPORT_READBACK_MISMATCH: import accepted but source records could not be verified. Keep this input and import ID; do not apply a fresh snapshot to retry.',
    );
  return { report, verified: true, verifiedSourceRecords: payload.records.length };
}
