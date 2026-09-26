import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  MISTAKE_LABELS,
  type ActivityDay,
  type PatternDetail,
  type PatternSummary,
  type WeeklyRecap,
} from '../../shared/contracts.js';
import { type Db, many, one, transaction, update } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import {
  assertMetadataVisible,
  discloseProblem,
  date,
  hiddenAssessment,
  problemViews,
  type TagRow,
} from '../catalogue/problem-model.js';
import {
  attempts,
  attemptView,
  checkVersion,
  getAttempt,
  NEWEST,
  studyDate,
  version,
} from '../attempts/attempt-model.js';
import { addDays } from '../attempts/review-schedule.js';
import { conflict } from '../db/errors.js';
import { decisions, NEWEST_DECISION } from './topic-model.js';

const reflectionFields = {
  mistakeLabels: z
    .array(z.enum(MISTAKE_LABELS))
    .max(MISTAKE_LABELS.length)
    .refine((v) => new Set(v).size === v.length, 'Duplicate mistake label'),
  takeaway: z.string().max(2000),
};
function patternNotebook(tag: TagRow) {
  return {
    id: tag.id,
    title: tag.name,
    description: tag.description,
    archived: !!tag.archived,
    recognitionCues: tag.recognitionCues,
    pitfalls: tag.pitfalls,
    notes: tag.patternNotes,
    version: tag.notebookVersion,
    updatedAt: tag.notebookUpdatedAt,
  };
}
const getTag = (db: Db, id: string) => one<TagRow>(db, 'SELECT * FROM tags WHERE id = ?', id);
export function activityDays(db: Db, end: string): ActivityDay[] {
  const counts = new Map(
    many<{ studyDate: string; n: number }>(
      db,
      "SELECT studyDate, count(*) AS n FROM attempts WHERE status = 'completed' GROUP BY studyDate",
    ).map((r) => [r.studyDate, r.n]),
  );
  return Array.from({ length: 28 }, (_, i) => {
    const date = addDays(end, i - 27);
    return { date, completedAttempts: counts.get(date) ?? 0 };
  });
}
function patternDetail(db: Db, tag: TagRow): PatternDetail {
  // In the order the problems were tagged.
  const tagged = many<{ problemId: string }>(
    db,
    'SELECT problemId FROM problem_tags WHERE tagId = ? ORDER BY rowid',
    tag.id,
  );
  const views = new Map(
    problemViews(
      db,
      'WHERE p.id IN (SELECT problemId FROM problem_tags WHERE tagId = ?)',
      tag.id,
    ).map((p) => [p.id, p]),
  );
  const examples = tagged.map(({ problemId }) => {
    const { id, title, url, difficulty } = discloseProblem(db, views.get(problemId)!);
    return { id, title, url, difficulty };
  });
  return { ...patternNotebook(tag), examples };
}
export function registerStudyTools(app: FastifyInstance, db: Db, clock: () => Date) {
  app.patch<{ Params: { id: string } }>('/api/attempts/:id/reflection', (req) => {
    assertMetadataVisible(db);
    const body = z
      .object({ version, ...reflectionFields })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const attempt = getAttempt(db, req.params.id);
      checkVersion(attempt, body.version);
      if (attempt.status !== 'completed')
        throw conflict('Finish the attempt before adding a reflection');
      update(db, 'attempts', attempt.id, { ...body, version: attempt.version + 1 });
      return attemptView(getAttempt(db, attempt.id));
    });
  });
  app.get('/api/mistakes', (req) => {
    assertMetadataVisible(db);
    const query = z
      .object({ q: z.string().max(300).optional(), label: z.enum(MISTAKE_LABELS).optional() })
      .strict()
      .parse(req.query);
    const q = query.q?.toLocaleLowerCase().trim();
    return attempts(
      db,
      `WHERE a.status = 'completed'
         AND (json_array_length(coalesce(a.mistakeLabels, '[]')) > 0 OR trim(coalesce(a.takeaway, '')) != '')
       ${NEWEST}`,
    )
      .filter(
        (a) =>
          (!query.label || a.mistakeLabels?.includes(query.label)) &&
          (!q ||
            [a.problem.title, a.takeaway ?? '', ...(a.mistakeLabels ?? [])]
              .join(' ')
              .toLocaleLowerCase()
              .includes(q)),
      )
      .map((a) => attemptView(a));
  });
  app.get('/api/patterns', (req) => {
    assertMetadataVisible(db);
    const { q } = z
      .object({ q: z.string().max(300).optional() })
      .strict()
      .parse(req.query);
    return many<TagRow>(db, 'SELECT * FROM tags ORDER BY rowid')
      .map(patternNotebook)
      .filter(
        (p) =>
          !q?.trim() ||
          [p.title, p.description, p.recognitionCues, p.pitfalls, p.notes]
            .join(' ')
            .toLocaleLowerCase()
            .includes(q.trim().toLocaleLowerCase()),
      )
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.title.localeCompare(b.title))
      .map(({ id, title, archived, version, updatedAt }): PatternSummary => ({
        id,
        title,
        archived,
        version,
        updatedAt,
      }));
  });
  app.get<{ Params: { id: string } }>('/api/patterns/:id', (req) => {
    assertMetadataVisible(db);
    return transaction(db, () => patternDetail(db, getTag(db, req.params.id)));
  });
  app.patch<{ Params: { id: string } }>('/api/patterns/:id', (req) => {
    assertMetadataVisible(db);
    const body = z
      .object({
        version,
        recognitionCues: z.string().max(1000000),
        pitfalls: z.string().max(1000000),
        notes: z.string().max(1000000),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const tag = getTag(db, req.params.id);
      checkVersion({ version: tag.notebookVersion }, body.version);
      update(db, 'tags', tag.id, {
        recognitionCues: body.recognitionCues,
        pitfalls: body.pitfalls,
        patternNotes: body.notes,
        notebookVersion: body.version + 1,
        notebookUpdatedAt: clock().toISOString(),
      });
      return patternDetail(db, getTag(db, tag.id));
    });
  });
  app.get('/api/recap', (req) => {
    const detailsHidden = hiddenAssessment(db);
    const query = z.object({ week: date.optional() }).strict().parse(req.query);
    const settings = readSettings(db);
    const day = query.week ?? studyDate(clock(), settings.timezone);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekStart = addDays(day, -((weekday + 6) % 7)),
      weekEnd = addDays(weekStart, 6);
    const scheduled = new Set(
      many<{ id: string }>(db, "SELECT id FROM plan_items WHERE reason = 'Scheduled review'").map(
        (i) => i.id,
      ),
    );
    const week = attempts(
      db,
      `WHERE a.status = 'completed' AND a.studyDate BETWEEN ? AND ? ${NEWEST}`,
      weekStart,
      weekEnd,
    ).map((a) => ({
      id: a.id,
      problemId: a.problemId,
      problem: a.problem,
      studyDate: a.studyDate,
      outcome: a.outcome,
      help: a.help,
      activeSeconds: a.activeSeconds,
      evidence: a.evidence,
      scheduledReview: !!a.planItemId && scheduled.has(a.planItemId),
    }));
    const movements = decisions(
      db,
      `WHERE d.date BETWEEN ? AND ? AND d.oldScore != d.newScore ${NEWEST_DECISION}, d.rowid`,
      weekStart,
      weekEnd,
    );
    return {
      weekStart,
      weekEnd,
      timezone: settings.timezone,
      distinctQuestions: new Set(week.map((a) => a.problemId)).size,
      completedAttempts: week.length,
      independentSolves: week.filter((a) => a.outcome === 'solved' && a.help === 'none').length,
      scheduledReviews: week.filter((a) => a.scheduledReview).length,
      detailsHidden,
      attempts: detailsHidden ? [] : week,
      movements: detailsHidden ? [] : movements,
    } satisfies WeeklyRecap;
  });
}
