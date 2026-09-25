import { readFile } from 'node:fs/promises';
import { args, writePrivateJson, printJson, runCli } from '../src/integrations/cli.js';
import { mapVerifiedLists, PINNED_REVISION } from '../src/integrations/lists.js';
import { LocalApi } from '../src/integrations/local-api.js';
import { applyAndVerify } from '../src/integrations/import-client.js';
import type { ProblemList } from '../src/shared/contracts.js';
runCli(async () => {
  const options = args({
    'dry-run': { type: 'boolean' },
    apply: { type: 'boolean' },
    output: { type: 'string' },
  });
  if (Boolean(options['dry-run']) === Boolean(options.apply))
    throw Error('Choose exactly one of --dry-run or --apply.');
  // Fixed retrieval provenance keeps the payload identical across retries.
  const result = mapVerifiedLists(
    await readFile(
      new URL('../src/integrations/manifests/neetcode-problems.json', import.meta.url),
      'utf8',
    ),
    PINNED_REVISION,
    '2026-09-16T00:00:00Z',
  );
  if (typeof options.output === 'string') await writePrivateJson(options.output, result);
  const summary = {
    importId: result.payload.importId,
    lists: result.lists,
    blockers: result.blockers,
  };
  if (options['dry-run']) {
    printJson({ ...summary, dryRun: true });
    return;
  }
  const api = new LocalApi();
  for (const list of result.lists) {
    const existing = ((await api.request('GET', '/api/lists')) as ProblemList[]).find(
      (l) => l.name.toLowerCase() === list.name.toLowerCase(),
    );
    if (
      existing &&
      (existing.sourceUrl !== list.sourceUrl || existing.sourceVersion !== list.sourceVersion)
    )
      throw Error(
        `List ${list.name} already exists with different/unverified provenance; refusing to relabel it.`,
      );
    if (!existing) {
      await api.request('POST', '/api/lists', {
        name: list.name,
        sourceUrl: list.sourceUrl,
        sourceVersion: list.sourceVersion,
      });
      const readback = (await api.request('GET', '/api/lists')) as ProblemList[];
      if (
        !readback.some(
          (l) =>
            l.name === list.name &&
            l.sourceUrl === list.sourceUrl &&
            l.sourceVersion === list.sourceVersion,
        )
      )
        throw Error(`List metadata read-back failed: ${list.name}.`);
    }
  }
  printJson({ ...summary, dryRun: false, ...(await applyAndVerify(api, result.payload)) });
});
