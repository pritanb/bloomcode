import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Settings } from '../shared/contracts.js';
import { mapVerifiedLists, PINNED_REVISION } from '../integrations/lists.js';
import { defaultRecommendations } from '../shared/recommendations.js';
import { durableTables } from './db.js';
import { conflict } from './errors.js';
import { applyImport, importSchema } from './import.js';
import type { Store } from './store.js';

const input = z
  .object({
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
    questionsPerDay: z.number().int().min(1).max(20),
    list: z.enum(['none', 'Blind 75', 'NeetCode 150', 'NeetCode 250']),
  })
  .strict();

export function registerSetup(app: FastifyInstance, store: Store, clock: () => Date, demo = false) {
  const settings = () => store.all<Settings & { id: string }>('settings')[0]!;
  const empty = () =>
    durableTables
      .filter((table) => table !== 'settings')
      .every((table) => !store.sql.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get());
  // Missing flags belong to older installations. Never send them through setup.
  const required = () => settings().onboardingComplete === false && empty();
  app.get('/api/setup', () => ({ required: required(), ...(demo ? { demo: true } : {}) }));
  app.post('/api/setup', (req) => {
    const body = input.parse(req.body);
    return store.transaction(() => {
      if (!required())
        throw conflict(
          'Setup is only available for a new, empty workspace. Use Settings to make changes.',
        );
      let listId: string | null = null;
      if (body.list !== 'none') {
        const raw = readFileSync(
          new URL('../../src/integrations/manifests/neetcode-problems.json', import.meta.url),
          'utf8',
        );
        const mapped = mapVerifiedLists(raw, PINNED_REVISION, '2026-09-16T00:00:00Z');
        const selected = mapped.lists.find((list) => list.name === body.list)!;
        listId = randomUUID();
        store.put('lists', {
          id: listId,
          name: selected.name,
          sourceUrl: selected.sourceUrl,
          sourceVersion: selected.sourceVersion,
        });
        const payload = importSchema.parse({
          ...mapped.payload,
          importId: `${mapped.payload.importId}:setup:${body.list.replaceAll(' ', '-')}`,
          dryRun: false,
          problems: mapped.payload.problems
            .filter((problem) => problem.lists?.includes(body.list))
            .map((problem) => ({ ...problem, lists: [body.list] })),
          records: [],
        });
        const report = applyImport(store, payload, clock);
        if (report.unresolved.length || report.counts.problems !== selected.count)
          throw new Error('Starter list did not import completely');
      }
      const updated: Settings = {
        ...settings(),
        timezone: body.timezone,
        questionsPerDay: body.questionsPerDay,
        onboardingComplete: true,
        recommendations: { ...defaultRecommendations, listId, completed: 'exclude' },
      };
      store.sql
        .prepare('UPDATE settings SET data = ? WHERE id = ?')
        .run(JSON.stringify(updated), 'singleton');
      return { required: false };
    });
  });
}
