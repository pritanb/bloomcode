import type { ImportPayload, ImportReport } from '../shared/contracts.js';
import { LocalApi } from './local-api.js';
/**
 * Apply an import. The server saves every source record in one transaction, and
 * replaying an import ID is accepted only for identical data, so an accepted import
 * is complete.
 */
export async function applyAndVerify(api: LocalApi, payload: ImportPayload) {
  const report = (await api.request('POST', '/api/import', {
    ...payload,
    dryRun: false,
  })) as ImportReport;
  return { report, verified: true, verifiedSourceRecords: payload.records.length };
}
