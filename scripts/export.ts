import { LocalApi } from '../src/integrations/local-api.js';
import { args, required, writePrivateJson, printJson, runCli } from '../src/integrations/cli.js';
import { snapshotSchema } from '../src/integrations/snapshot.js';
runCli(async () => {
  const options = args({ output: { type: 'string' } });
  const output = required(options.output, 'output');
  const snapshot = snapshotSchema.parse(await new LocalApi().request('GET', '/api/export'));
  await writePrivateJson(output, snapshot);
  printJson({
    output,
    schemaVersion: snapshot.schemaVersion,
    counts: Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length])),
  });
});
