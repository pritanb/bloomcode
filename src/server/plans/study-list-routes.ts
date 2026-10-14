import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Db, transaction } from '../db/db.js';
import { writeSettings } from '../db/settings.js';
import { conflict } from '../db/errors.js';
import { idempotent } from '../db/idempotency.js';
import { confirmedStudyListChange } from '../../shared/study-list.js';
import { ensurePlan, replan } from './plans.js';
import {
  previewList,
  resolveEntries,
  setStudyList,
  studyListView,
  studySetList,
} from './study-list.js';

export function registerStudyList(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/study-list', () => studyListView(db));
  app.get('/api/study-sets', () =>
    studySetList().map((s) => ({
      id: s.id,
      name: s.name,
      source: s.source,
      sections: s.sections.map((x) => ({ name: x.name, problems: x.slugs.length })),
    })),
  );
  const entries = z.array(z.string().max(300)).max(500);
  // Read-only for the tutor: what a proposed list would hold, before the learner confirms.
  app.post('/api/study-list/preview', (req) => {
    const b = z
      .object({
        set: z.string().max(100).optional(),
        from: z.string().max(200).optional(),
        problems: entries.optional(),
      })
      .strict()
      .parse(req.body);
    return previewList(db, b);
  });
  // Settings: replace the list from pasted links, slugs or titles (who plans is separate).
  app.post('/api/study-list', (req) => {
    const b = z.object({ entries }).strict().parse(req.body);
    return transaction(db, () => {
      const { slugs, unmatched } = resolveEntries(db, b.entries);
      setStudyList(db, clock, slugs);
      return { ...studyListView(db), unmatched };
    });
  });
  // Scoped tutor credentials cannot enter this route. Only the host's explicit
  // confirmation flow commits a list Bloom proposed, then re-plans today with it.
  app.post('/api/study-list/changes', (req) => {
    const body = confirmedStudyListChange.parse(req.body);
    return idempotent(db, 'study-list-change', req.headers['idempotency-key'], body, () => {
      const { planSource, name, slugs } = body.change;
      if (slugs) setStudyList(db, clock, slugs, name);
      else if (planSource === 'list' && !studyListView(db).slugs.length)
        throw conflict('There is no saved study list to resume');
      writeSettings(db, { planSource });
      const plan = replan(
        db,
        clock,
        app.bloomPlanner,
        ensurePlan(db, clock, undefined, app.bloomPlanner),
      );
      return { list: studyListView(db), plan };
    });
  });
}
