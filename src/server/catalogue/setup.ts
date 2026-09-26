import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { mapVerifiedLists, PINNED_REVISION } from '../../integrations/lists.js';
import { defaultRecommendations } from '../../shared/recommendations.js';
import { type Db, insert, maybe, transaction } from '../db/db.js';
import { readSettings, writeSettings } from '../db/settings.js';
import { conflict } from '../db/errors.js';
import { applyImport, importSchema } from './import.js';
import { repoRoot } from '../paths.js';

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

const studyTables = [
  'problems',
  'tags',
  'lists',
  'attempts',
  'topics',
  'daily_plans',
  'import_batches',
  'insight_jobs',
  'topic_analysis',
];
export function registerSetup(app: FastifyInstance, db: Db, clock: () => Date, demo = false) {
  const empty = () => studyTables.every((table) => !maybe(db, `SELECT 1 FROM ${table} LIMIT 1`));
  // Missing flags belong to older installations. Never send them through setup.
  const required = () => readSettings(db).onboardingComplete === false && empty();
  app.get('/api/setup', () => ({ required: required(), ...(demo ? { demo: true } : {}) }));
  app.post('/api/setup', (req) => {
    const body = input.parse(req.body);
    return transaction(db, () => {
      if (!required())
        throw conflict(
          'Setup is only available for a new, empty workspace. Use Settings to make changes.',
        );
      let listId: string | null = null;
      if (body.list !== 'none') {
        const raw = readFileSync(
          new URL('src/integrations/manifests/neetcode-problems.json', repoRoot),
          'utf8',
        );
        const mapped = mapVerifiedLists(raw, PINNED_REVISION, '2026-09-16T00:00:00Z');
        const selected = mapped.lists.find((list) => list.name === body.list)!;
        listId = randomUUID();
        insert(db, 'lists', {
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
        const report = applyImport(db, payload, clock);
        if (report.unresolved.length || report.counts.problems !== selected.count)
          throw new Error('Starter list did not import completely');
      }
      writeSettings(db, {
        timezone: body.timezone,
        questionsPerDay: body.questionsPerDay,
        onboardingComplete: true,
        recommendations: { ...defaultRecommendations, listId, completed: 'exclude' },
      });
      return { required: false };
    });
  });
}
