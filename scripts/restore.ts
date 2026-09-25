import { LocalApi } from '../src/integrations/local-api.js';
import { args, required, readJson, printJson, runCli } from '../src/integrations/cli.js';
import { snapshotSchema, sameTables } from '../src/integrations/snapshot.js';
runCli(async () => {
  const options = args({ input: { type: 'string' }, 'confirm-empty': { type: 'boolean' } });
  if (options['confirm-empty'] !== true)
    throw Error(
      'Restore requires --confirm-empty. Use a NEW, isolated DATA_DIR; existing data is never overwritten.',
    );
  const snapshot = snapshotSchema.parse(await readJson(required(options.input, 'input')));
  const api = new LocalApi();
  const result = await api.request('POST', '/api/restore', { snapshot, confirmEmpty: true });
  const readback = await api.request('GET', '/api/export');
  if (!sameTables(snapshot, readback))
    throw Error(
      'RESTORE_READBACK_MISMATCH: restore was accepted but exported table content differs. Stop and inspect the isolated restore; do not delete the original.',
    );
  printJson({ result, verified: true });
});
