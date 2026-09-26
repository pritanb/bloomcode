import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Problem, ProblemList } from '../../shared/contracts.js';
import { attempts, attemptView, NEWEST } from '../attempts/attempt-model.js';
import { type Db, insert, many, maybe, one, transaction, update } from '../db/db.js';
import { reviewTargets } from '../attempts/review-schedule.js';
import { conflict } from '../db/errors.js';
import { newTagHue } from '../db/tag-colour.js';
import { listProjection } from './list-projection.js';
import {
  name,
  problemUrl,
  tagView,
  type TagRow,
  problemView,
  problemViews,
  assignLinks,
  addProblem,
  discloseProblem,
  assertMetadataVisible,
  getProblem,
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
    .array(z.object({ tagId: z.string() }).strict())
    .max(100)
    .optional(),
  listIds: z.array(z.string()).max(100).optional(),
};
export function registerCatalogue(app: FastifyInstance, db: Db) {
  const tagNamed = (tagName: string, except = '') =>
    maybe(db, 'SELECT 1 FROM tags WHERE lower(name) = lower(?) AND id != ?', tagName, except);
  app.get('/api/tags', () => many<TagRow>(db, 'SELECT * FROM tags ORDER BY rowid').map(tagView));
  app.post('/api/tags', (req) => {
    const b = z
      .object({
        name,
        description: z.string().max(20000).optional(),
        kind: z.enum(['topic', 'pattern']).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      if (tagNamed(b.name)) throw conflict('Tag name already exists');
      const hues = many<{ hue: number }>(db, 'SELECT hue FROM tags WHERE hue IS NOT NULL');
      const id = randomUUID();
      insert(db, 'tags', {
        id,
        name: b.name,
        description: b.description ?? '',
        kind: b.kind ?? 'pattern',
        hue: newTagHue(hues.map((t) => t.hue)),
      });
      return tagView(one<TagRow>(db, 'SELECT * FROM tags WHERE id = ?', id));
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
      .parse(req.body);
    return transaction(db, () => {
      one(db, 'SELECT 1 FROM tags WHERE id = ?', req.params.id);
      if (b.name && tagNamed(b.name, req.params.id)) throw conflict('Tag name already exists');
      if (
        b.hue !== undefined &&
        maybe(db, 'SELECT 1 FROM tags WHERE hue = ? AND id != ?', b.hue, req.params.id)
      )
        throw conflict('This colour is already used by another tag. Choose a different colour.');
      update(db, 'tags', req.params.id, b);
      return tagView(one<TagRow>(db, 'SELECT * FROM tags WHERE id = ?', req.params.id));
    });
  });
  app.get('/api/lists', () => listProjection(db).lists);
  app.post('/api/lists', (req) => {
    const b = z
      .object({
        name,
        sourceUrl: z.url().optional(),
        sourceVersion: z.string().max(300).optional(),
      })
      .strict()
      .parse(req.body);
    if (maybe(db, 'SELECT 1 FROM lists WHERE lower(name) = lower(?)', b.name))
      throw conflict('List name already exists');
    return insert<ProblemList>(db, 'lists', {
      id: randomUUID(),
      name: b.name,
      sourceUrl: b.sourceUrl ?? null,
      sourceVersion: b.sourceVersion ?? null,
    });
  });
  // Showing a problem's own tags, lists, notes or topics reveals it.
  const shown = (p: Problem) =>
    p.tags.length || p.lists.length || p.notes || p.leetcodeTopics?.length
      ? discloseProblem(db, p)
      : p;
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
    return transaction(db, () => {
      const p = addProblem(db, b);
      assertMetadataVisible(db, p.id);
      assignLinks(db, p.id, b, true);
      return shown(problemView(db, p.id));
    });
  });
  app.patch<{ Params: { id: string } }>('/api/problems/:id', (req) => {
    assertMetadataVisible(db, req.params.id);
    const b = z
      .object({
        title: name.optional(),
        notes: z.string().max(100000).optional(),
        difficulty: difficulty.optional(),
        ...links,
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const p = getProblem(db, req.params.id);
      const { tags: _tags, listIds: _lists, ...fields } = b;
      assignLinks(db, p.id, b, true);
      update(db, 'problems', p.id, fields);
      return shown(problemView(db, p.id));
    });
  });
  app.get<{ Params: { id: string } }>('/api/problems/:id', (req) => {
    assertMetadataVisible(db, req.params.id);
    return transaction(db, () => ({
      problem: discloseProblem(db, problemView(db, req.params.id)),
      attempts: attempts(db, `WHERE a.problemId = ? ${NEWEST}`, req.params.id).map(attemptView),
      reviews: reviewTargets(db, 'WHERE r.problemId = ?', req.params.id),
    }));
  });
  app.get('/api/problems', (req) => {
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
        listId: z.string().optional(),
        difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
        confidence: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
        timeBucket: z.enum(['0-10', '10-20', '20-30', '30-45', '45+', 'unknown']).optional(),
        sort: z
          .enum(['title', 'lastAttempt', 'solveTime', 'reviewDate', 'difficulty', 'confidence'])
          .default('title'),
        direction: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(req.query);
    // Columns come from problemViews' summary: p = problem, d = latest completed attempt,
    // s = latest solve, r = latest rated attempt.
    const where: string[] = [
        `NOT EXISTS (SELECT 1 FROM attempts h WHERE h.problemId = p.id AND h.context = 'mixed' AND h.status != 'completed')`,
      ],
      params: (string | number)[] = [];
    const filter = (clause: string, ...values: (string | number)[]) => {
      where.push(clause);
      params.push(...values);
    };
    if (q.search) filter(`instr(lower(p.title || ' ' || p.url), lower(?)) > 0`, q.search);
    if (q.leetcodeTopic)
      filter(
        `(EXISTS (SELECT 1 FROM json_each(coalesce(p.leetcodeTopics, '[]')) j WHERE instr(lower(j.value), lower(?)) > 0)
          OR EXISTS (SELECT 1 FROM problem_tags pt JOIN tags g ON g.id = pt.tagId
            WHERE pt.problemId = p.id AND g.kind = 'topic' AND instr(lower(g.name), lower(?)) > 0))`,
        q.leetcodeTopic,
        q.leetcodeTopic,
      );
    const solved = '(p.legacyCompleted OR s.help IS NOT NULL)';
    if (q.status === 'completed') filter(solved);
    if (q.status === 'unsolved') filter(`NOT ${solved}`);
    if (['solved', 'not_solved', 'stopped'].includes(q.status)) filter('d.outcome = ?', q.status);
    if (q.status === 'not_submitted') filter('d.id IS NULL');
    if (q.status === 'attempted') filter('d.id IS NOT NULL');
    if (q.difficulty) filter('p.difficulty = ?', q.difficulty);
    const wanted = [...new Set(q.tags?.split(',').filter(Boolean) ?? [])];
    if (wanted.length) {
      const matches = `(SELECT count(*) FROM problem_tags WHERE problemId = p.id AND tagId IN (${wanted.map(() => '?').join(', ')}))`;
      filter(q.tagMode === 'all' ? `${matches} = ${wanted.length}` : `${matches} > 0`, ...wanted);
    }
    if (q.confidence)
      filter(
        {
          unknown: 'r.confidence IS NULL',
          low: 'r.confidence < 3',
          medium: 'r.confidence >= 3 AND r.confidence < 4',
          high: 'r.confidence >= 4',
        }[q.confidence],
      );
    if (q.timeBucket)
      filter(
        {
          unknown: 's.activeSeconds IS NULL',
          '0-10': 's.activeSeconds < 600',
          '10-20': 's.activeSeconds >= 600 AND s.activeSeconds < 1200',
          '20-30': 's.activeSeconds >= 1200 AND s.activeSeconds < 1800',
          '30-45': 's.activeSeconds >= 1800 AND s.activeSeconds < 2700',
          '45+': 's.activeSeconds >= 2700',
        }[q.timeBucket],
      );
    // List membership also comes from the bundled NeetCode manifests, so it is checked here.
    const items = problemViews(db, `WHERE ${where.join(' AND ')}`, ...params).filter(
      (p) => !q.listId || p.lists.some((l) => l.id === q.listId),
    );
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
                : p.nextReviewDate;
    // Titles sort by locale rules, which SQLite's byte order does not follow.
    items.sort((a, b) => {
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
    const page = transaction(db, () =>
      items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(shown),
    );
    return { items: page, total: items.length, page: q.page, pageSize: q.pageSize };
  });
}
