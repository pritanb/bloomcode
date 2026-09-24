import { readFile } from 'node:fs/promises';
import { args, printJson, runCli } from '../src/integrations/cli.js';
import { mapQuestionPack } from '../src/integrations/question-pack.js';
import { LocalApi } from '../src/integrations/local-api.js';
import { applyAndVerify } from '../src/integrations/import-client.js';
runCli(async () => {
  const options = args({ input: { type: 'string' }, 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' } });
  if (typeof options.input !== 'string' || Boolean(options['dry-run']) === Boolean(options.apply)) throw Error('Provide --input <file> and exactly one of --dry-run or --apply.');
  const payload = mapQuestionPack(JSON.parse(await readFile(options.input, 'utf8')));
  if (options['dry-run']) { printJson({ dryRun: true, importId: payload.importId, questions: payload.problems.length }); return; }
  printJson(await applyAndVerify(new LocalApi(), payload));
});
