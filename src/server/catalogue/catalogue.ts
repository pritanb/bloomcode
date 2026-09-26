import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Problem, Tag, ProblemList } from '../../shared/contracts.js';
import { newestAttempt, attemptView, type AttemptRecord } from '../attempts/attempt-model.js';
import type { ReviewTarget } from '../../shared/contracts.js';
import { Store } from '../db/store.js';
import { conflict, ApiError } from '../db/errors.js';
import { listProjection } from './list-projection.js';
import {
  name,
  problemUrl,
  tagView,
  problemView,
  assignLinks,
  addProblem,
  discloseProblem,
  assertMetadataVisible,
} from './problem-model.js';
const difficulty = z.enum(['Easy', 'Medium', 'Hard']).nullable();
const links = {
  leetcodeTopics: z
    .array(name)
    .max(50)
    .transform((values) => [
      ...new Map(values.map((value) => [value.toLowerCase(), value])).values(),
    ])
    .optional(),
  tags: z
    .array(
      z
        .object({
          tagId: z.string(),
          difficulty: z.number().int().min(1).max(10).nullable().optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
  listIds: z.array(z.string()).max(100).optional(),
};
export function registerCatalogue(app: FastifyInstance, s: Store, clock: () => Date) {
  app.get('/api/tags', () => s.all<Tag>('tags').map(tagView));
  app.post('/api/tags', (req) => {
    const b = z
      .object({
        name,
        description: z.string().max(20000).optional(),
        kind: z.enum(['topic', 'pattern']).optional(),
      })
      .strict()
      .parse(req.body);
    if (s.all<Tag>('tags').some((t) => t.name.toLowerCase() === b.name.toLowerCase()))
      throw conflict('Tag name already exists');
    return s.put('tags', {
      id: randomUUID(),
      name: b.name,
      description: b.description ?? '',
      archived: false,
      kind: b.kind ?? 'pattern',
    });
  });
  app.patch<{ Params: { id: string } }>('/api/tags/:id', (req) => {
    const b = z
        .object({
          kind: z.enum(['topic', 'pattern']).optional(),
          name: name.optional(),
          description: z.string().max(20000).optional(),
          archived: z.boolean().optional(),
          hue: z.number().min(0).lt(360).optional(),
        })
        .strict()
        .parse(req.body),
      t = s.get<Tag>('tags', req.params.id);
    if (
      b.name &&
      s
        .all<Tag>('tags')
        .some((x) => x.id !== t.id && x.name.toLowerCase() === b.name!.toLowerCase())
    )
      throw conflict('Tag name already exists');
    if (b.hue !== undefined && s.all<Tag>('tags').some((x) => x.id !== t.id && x.hue === b.hue))
      throw conflict('This colour is already used by another tag. Choose a different colour.');
    return tagView(s.put('tags', { ...t, ...b }));
  });
  app.get('/api/lists', () => listProjection(s).lists);
  app.post('/api/lists', (req) => {
    const b = z
      .object({
        name,
        sourceUrl: z.url().optional(),
        sourceVersion: z.string().max(300).optional(),
      })
      .strict()
      .parse(req.body);
    if (s.all<ProblemList>('lists').some((t) => t.name.toLowerCase() === b.name.toLowerCase()))
      throw conflict('List name already exists');
    return s.put('lists', {
      id: randomUUID(),
      name: b.name,
      sourceUrl: b.sourceUrl ?? null,
      sourceVersion: b.sourceVersion ?? null,
    });
  });
  app.post('/api/problems', (req) => {
    const b = z
      .object({
        title: name,
        url: problemUrl,
        difficulty: difficulty.optional(),
        notes: z.string().max(100000).optional(),
        ...links,
      })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const p = addProblem(s, b);
      assertMetadataVisible(s, p.id);
      assignLinks(s, p.id, b, true);
      const view = problemView(s, p);
      return view.tags.length || view.lists.length || view.notes || view.leetcodeTopics?.length
        ? discloseProblem(s, view, clock)
        : view;
    });
  });
  app.patch<{ Params: { id: string } }>('/api/problems/:id', (req) => {
    assertMetadataVisible(s, req.params.id);
    const b = z
      .object({
        title: name.optional(),
        notes: z.string().max(100000).optional(),
        difficulty: difficulty.optional(),
        ...links,
      })
      .strict()
      .parse(req.body);
    return s.transaction(() => {
      const p = s.get<Problem>('problems', req.params.id);
      const { tags: _tags, listIds: _lists, ...fields } = b;
      assignLinks(s, p.id, b, true);
      const view = problemView(s, s.put('problems', { ...p, ...fields }));
      return view.tags.length || view.lists.length || view.notes || view.leetcodeTopics?.length
        ? discloseProblem(s, view, clock)
        : view;
    });
  });
  app.get<{ Params: { id: string } }>('/api/problems/:id', (req) => {
    assertMetadataVisible(s, req.params.id);
    return s.transaction(() => ({
      problem: discloseProblem(s, problemView(s, s.get<Problem>('problems', req.params.id)), clock),
      attempts: s
        .all<AttemptRecord>('attempts')
        .filter((a) => a.problemId === req.params.id)
        .sort(newestAttempt)
        .map(attemptView),
      reviews: s.all<ReviewTarget>('review_targets').filter((r) => r.problemId === req.params.id),
    }));
  });
  app.get('/api/problems', (req) => {
    const hidden = new Set(
      s
        .all<AttemptRecord>('attempts')
        .filter((a) => a.context === 'mixed' && a.status !== 'completed')
        .map((a) => a.problemId),
    );
    const q = z
      .object({
        search: z.string().optional(),
        leetcodeTopic: name.optional(),
        status: z
          .enum([
            'all',
            'solved',
            'not_solved',
            'stopped',
            'not_submitted',
            'unsolved',
            'completed',
            'attempted',
          ])
          .default('all'),
        tags: z.string().optional(),
        tagMode: z.enum(['any', 'all']).default('any'),
        tagDifficultyMin: z.coerce.number().int().min(1).max(10).optional(),
        tagDifficultyMax: z.coerce.number().int().min(1).max(10).optional(),
        listId: z.string().optional(),
        difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
        confidence: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
        timeBucket: z.enum(['0-10', '10-20', '20-30', '30-45', '45+', 'unknown']).optional(),
        sort: z
          .enum([
            'title',
            'lastAttempt',
            'solveTime',
            'reviewDate',
            'tagDifficulty',
            'difficulty',
            'confidence',
          ])
          .default('title'),
        direction: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(req.query);
    if (
      q.tagDifficultyMin !== undefined &&
      q.tagDifficultyMax !== undefined &&
      q.tagDifficultyMin > q.tagDifficultyMax
    )
      throw new ApiError(400, 'VALIDATION', 'Minimum tag difficulty must not exceed maximum');
    const latestConfidence = new Map<string, number | null>();
    for (const attempt of s
      .all<AttemptRecord>('attempts')
      .filter((a) => a.status === 'completed' && a.confidence != null)
      .sort(newestAttempt)) {
      if (!latestConfidence.has(attempt.problemId))
        latestConfidence.set(attempt.problemId, attempt.confidence ?? null);
    }
    const wanted = q.tags?.split(',').filter(Boolean) ?? [];
    const projection = listProjection(s);
    let items = s
      .all<Problem>('problems')
      .filter((p) => !hidden.has(p.id))
      .map((p) => problemView(s, p, projection))
      .filter((p) => {
        if (q.search && !`${p.title} ${p.url}`.toLowerCase().includes(q.search.toLowerCase()))
          return false;
        if (
          q.leetcodeTopic &&
          ![
            ...(p.leetcodeTopics ?? []),
            ...p.tags.filter((t) => t.kind === 'topic').map((t) => t.name),
          ].some((topic) => topic.toLowerCase().includes(q.leetcodeTopic!.toLowerCase()))
        )
          return false;
        const solved = p.legacyCompleted || p.lastSolveHelp !== null;
        if (q.status === 'completed' && !solved) return false;
        if (
          ['solved', 'not_solved', 'stopped'].includes(q.status) &&
          p.latestSubmission?.outcome !== q.status
        )
          return false;
        if (q.status === 'not_submitted' && p.latestSubmission) return false;
        if (q.status === 'unsolved' && solved) return false;
        if (q.status === 'attempted' && p.attemptCount === 0) return false;
        if (q.listId && !p.lists.some((l) => l.id === q.listId)) return false;
        if (q.difficulty && p.difficulty !== q.difficulty) return false;
        const matching = p.tags.filter(
          (t) =>
            (q.tagDifficultyMin === undefined ||
              (t.difficulty !== null && t.difficulty >= q.tagDifficultyMin)) &&
            (q.tagDifficultyMax === undefined ||
              (t.difficulty !== null && t.difficulty <= q.tagDifficultyMax)),
        );
        if (
          wanted.length &&
          (q.tagMode === 'all'
            ? !wanted.every((id) => matching.some((t) => t.id === id))
            : !matching.some((t) => wanted.includes(t.id)))
        )
          return false;
        if (
          !wanted.length &&
          (q.tagDifficultyMin !== undefined || q.tagDifficultyMax !== undefined) &&
          !matching.length
        )
          return false;
        if (q.confidence) {
          const confidence = latestConfidence.get(p.id) ?? null;
          if (q.confidence === 'unknown') {
            if (confidence !== null) return false;
          } else if (
            confidence === null ||
            (q.confidence === 'low'
              ? confidence >= 3
              : q.confidence === 'medium'
                ? confidence < 3 || confidence >= 4
                : confidence < 4)
          )
            return false;
        }
        if (q.timeBucket) {
          const n = p.lastSolveSeconds;
          if (q.timeBucket === 'unknown') return n === null;
          if (n === null) return false;
          const ranges: Record<string, [number, number]> = {
            '0-10': [0, 600],
            '10-20': [600, 1200],
            '20-30': [1200, 1800],
            '30-45': [1800, 2700],
            '45+': [2700, Infinity],
          };
          const [min, max] = ranges[q.timeBucket]!;
          if (n < min || n >= max) return false;
        }
        return true;
      });
    const val = (p: Problem): string | number | null =>
      q.sort === 'title'
        ? p.title.toLowerCase()
        : q.sort === 'difficulty'
          ? p.difficulty
            ? ({ Easy: 1, Medium: 2, Hard: 3 }[p.difficulty] ?? null)
            : null
          : q.sort === 'confidence'
            ? (p.latestConfidence ?? null)
            : q.sort === 'lastAttempt'
              ? p.lastAttemptAt
              : q.sort === 'solveTime'
                ? p.lastSolveSeconds
                : q.sort === 'reviewDate'
                  ? p.nextReviewDate
                  : (p.tags
                      .filter((t) => !wanted.length || wanted.includes(t.id))
                      .map((t) => t.difficulty)
                      .filter((n): n is number => n !== null)
                      .sort((a, b) => b - a)[0] ?? null);
    items = items.sort((a, b) => {
      const x = val(a),
        y = val(b);
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      const cmp =
        x === y
          ? 0
          : typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
      return (q.direction === 'asc' ? cmp : -cmp) || a.id.localeCompare(b.id);
    });
    const page = s.transaction(() =>
      items
        .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
        .map((p) =>
          p.tags.length || p.lists.length || p.notes || p.leetcodeTopics?.length
            ? discloseProblem(s, p, clock)
            : p,
        ),
    );
    return { items: page, total: items.length, page: q.page, pageSize: q.pageSize };
  });
}
