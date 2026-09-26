import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  MISTAKE_LABELS,
  type ActivityDay,
  type PatternDetail,
  type PatternSummary,
  type Problem,
  type Settings,
  type ScoreDecision,
  type WeeklyRecap,
} from '../../shared/contracts.js';
import { Store } from '../db/store.js';
import { assertMetadataVisible, discloseProblem, date } from '../catalogue/problem-model.js';
import {
  attemptView,
  checkVersion,
  newestAttempt,
  studyDate,
  version,
  type AttemptRecord,
} from '../attempts/attempt-model.js';
import { addDays } from '../attempts/review-schedule.js';
import { conflict } from '../db/errors.js';
import { patternNotebook } from '../../shared/pattern-migration.js';
import type { TagLink } from '../catalogue/problem-model.js';
import type { Tag } from '../../shared/contracts.js';
import { decisionView } from './topic-model.js';
import type { ItemRecord } from '../plans/plan-model.js';

const reflectionFields = {
  mistakeLabels: z
    .array(z.enum(MISTAKE_LABELS))
    .max(MISTAKE_LABELS.length)
    .refine((v) => new Set(v).size === v.length, 'Duplicate mistake label'),
  takeaway: z.string().max(2000),
};
export function activityDays(s: Store, end: string): ActivityDay[] {
  const counts = new Map<string, number>();
  for (const attempt of s.all<AttemptRecord>('attempts'))
    if (attempt.status === 'completed')
      counts.set(attempt.studyDate, (counts.get(attempt.studyDate) ?? 0) + 1);
  return Array.from({ length: 28 }, (_, i) => {
    const date = addDays(end, i - 27);
    return { date, completedAttempts: counts.get(date) ?? 0 };
  });
}
function patternDetail(s: Store, tag: Tag, clock: () => Date): PatternDetail {
  const examples = s
    .all<TagLink>('problem_tags')
    .filter((link) => link.tagId === tag.id)
    .map((link) => {
      const { id, title, url, difficulty } = discloseProblem(
        s,
        s.get<Problem>('problems', link.problemId),
        clock,
      );
      return { id, title, url, difficulty, patternDifficulty: link.difficulty };
    });
  return { ...patternNotebook({ ...tag }), examples };
}
export function registerStudyTools(app: FastifyInstance, s: Store, clock: () => Date) {
  app.patch<{ Params: { id: string } }>('/api/attempts/:id/reflection', (req) => {
    assertMetadataVisible(s);
    const body = z
      .object({ version, ...reflectionFields })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const attempt = s.get<AttemptRecord>('attempts', req.params.id);
      checkVersion(attempt, body.version);
      if (attempt.status !== 'completed')
        throw conflict('Finish the attempt before adding a reflection');
      return attemptView(s.put('attempts', { ...attempt, ...body, version: attempt.version + 1 }));
    });
  });
  app.get('/api/mistakes', (req) => {
    assertMetadataVisible(s);
    const query = z
      .object({ q: z.string().max(300).optional(), label: z.enum(MISTAKE_LABELS).optional() })
      .strict()
      .parse(req.query);
    const q = query.q?.toLocaleLowerCase().trim();
    return s
      .all<AttemptRecord>('attempts')
      .filter(
        (a) =>
          a.status === 'completed' &&
          ((a.mistakeLabels?.length ?? 0) > 0 || !!a.takeaway?.trim()) &&
          (!query.label || a.mistakeLabels?.includes(query.label)) &&
          (!q ||
            [a.problem.title, a.takeaway ?? '', ...(a.mistakeLabels ?? [])]
              .join(' ')
              .toLocaleLowerCase()
              .includes(q)),
      )
      .sort(newestAttempt)
      .map((a) => attemptView(a));
  });
  app.get('/api/patterns', (req) => {
    assertMetadataVisible(s);
    const { q } = z
      .object({ q: z.string().max(300).optional() })
      .strict()
      .parse(req.query);
    return s
      .all<Tag>('tags')
      .map((tag) => patternNotebook({ ...tag }))
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
    assertMetadataVisible(s);
    return s.transaction(() => patternDetail(s, s.get<Tag>('tags', req.params.id), clock));
  });
  app.patch<{ Params: { id: string } }>('/api/patterns/:id', (req) => {
    assertMetadataVisible(s);
    const body = z
      .object({
        version,
        recognitionCues: z.string().max(1000000),
        pitfalls: z.string().max(1000000),
        notes: z.string().max(1000000),
      })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const tag = s.get<Tag>('tags', req.params.id);
      checkVersion({ version: tag.notebookVersion ?? 1 }, body.version);
      return patternDetail(
        s,
        s.put('tags', {
          ...tag,
          recognitionCues: body.recognitionCues,
          pitfalls: body.pitfalls,
          patternNotes: body.notes,
          notebookVersion: body.version + 1,
          notebookUpdatedAt: clock().toISOString(),
        }),
        clock,
      );
    });
  });
  app.get('/api/recap', (req) => {
    const detailsHidden = s
      .all<AttemptRecord>('attempts')
      .some((a) => a.context === 'mixed' && a.status !== 'completed');
    const query = z.object({ week: date.optional() }).strict().parse(req.query);
    const settings = s.get<Settings & { id: string }>('settings', 'singleton');
    const day = query.week ?? studyDate(clock(), settings.timezone);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekStart = addDays(day, -((weekday + 6) % 7)),
      weekEnd = addDays(weekStart, 6);
    const items = new Map(s.all<ItemRecord>('plan_items').map((item) => [item.id, item]));
    const attempts = s
      .all<AttemptRecord>('attempts')
      .filter((a) => a.status === 'completed' && a.studyDate >= weekStart && a.studyDate <= weekEnd)
      .sort(newestAttempt)
      .map((a) => ({
        id: a.id,
        problemId: a.problemId,
        problem: a.problem,
        studyDate: a.studyDate,
        outcome: a.outcome,
        help: a.help,
        activeSeconds: a.activeSeconds,
        evidence: a.evidence,
        scheduledReview: !!a.planItemId && items.get(a.planItemId)?.reason === 'Scheduled review',
      }));
    const movements = s
      .all<ScoreDecision>('score_decisions')
      .filter((d) => d.date >= weekStart && d.date <= weekEnd && d.oldScore !== d.newScore)
      .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))
      .map(decisionView);
    return {
      weekStart,
      weekEnd,
      timezone: settings.timezone,
      distinctQuestions: new Set(attempts.map((a) => a.problemId)).size,
      completedAttempts: attempts.length,
      independentSolves: attempts.filter((a) => a.outcome === 'solved' && a.help === 'none').length,
      scheduledReviews: attempts.filter((a) => a.scheduledReview).length,
      detailsHidden,
      attempts: detailsHidden ? [] : attempts,
      movements: detailsHidden ? [] : movements,
    } satisfies WeeklyRecap;
  });
}
