// Problems with their tags and lists, and the shared validation and visibility rules.
import { problemRating } from '../topics/ratings.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Help, Outcome, Problem, ReviewTarget, Tag } from '../../shared/contracts.js';
import { type Db, insert, many, maybe, one, run, update } from '../db/db.js';
import { ApiError, missing } from '../db/errors.js';
import { listProjection } from './list-projection.js';
export const name = z.string().trim().min(1).max(300);
export const date = z.iso.date();
export const problemUrl = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/(?:www\.)?leetcode\.(?:com|cn)\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:description|editorial|solutions|submissions))?\/?(?:\?[^\s#\\]*)?(?:#[^\s\\]*)?$/,
    'Expected an unmodified HTTPS LeetCode problem URL',
  );

export interface TagRow {
  id: string;
  name: string;
  description: string;
  archived: number;
  kind: 'topic' | 'pattern';
  hue: number | null;
  recognitionCues: string;
  pitfalls: string;
  patternNotes: string;
  notebookVersion: number;
  notebookUpdatedAt: string | null;
}
export function tagView(t: TagRow): Tag {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    archived: !!t.archived,
    kind: t.kind,
    ...(t.hue === null ? {} : { hue: t.hue }),
  };
}
/** The problem as stored, without the summary computed from its attempts. */
export interface ProblemRow {
  id: string;
  slug: string;
  title: string;
  url: string;
  difficulty: string | null;
  notes: string;
  leetcodeTopics: string | null;
  legacyCompleted: number;
  exposed: number;
}
export const getProblem = (db: Db, id: string) =>
  one<ProblemRow>(db, 'SELECT * FROM problems WHERE id = ?', id);

// Each problem with the latest completed, solved and rated attempt, and its review target.
const latest = `row_number() OVER (PARTITION BY problemId ORDER BY coalesce(finishedAt, startedAt) DESC, id DESC)`;
const summary = `
  WITH done AS (
    SELECT *, ${latest} AS n, count(*) OVER (PARTITION BY problemId) AS total
    FROM attempts WHERE status = 'completed'),
  solved AS (SELECT problemId, activeSeconds, help, ${latest} AS n
    FROM attempts WHERE status = 'completed' AND outcome = 'solved'),
  rated AS (SELECT problemId, confidence, ${latest} AS n
    FROM attempts WHERE status = 'completed' AND confidence IS NOT NULL)
  SELECT p.*, coalesce(d.total, 0) AS attemptCount, d.id AS submissionId, d.outcome AS lastOutcome,
    d.help AS submissionHelp, d.language AS submissionLanguage, d.activeSeconds AS submissionSeconds,
    d.confidence AS submissionConfidence, d.notes AS submissionNotes, d.finishedAt AS lastAttemptAt,
    d.nextReviewDate AS submissionReview, s.activeSeconds AS lastSolveSeconds,
    s.help AS lastSolveHelp, r.confidence AS latestConfidence,
    t.effectiveDate AS nextReviewDate, t.action AS reviewAction
  FROM problems p
  LEFT JOIN done d ON d.problemId = p.id AND d.n = 1
  LEFT JOIN solved s ON s.problemId = p.id AND s.n = 1
  LEFT JOIN rated r ON r.problemId = p.id AND r.n = 1
  LEFT JOIN review_targets t ON t.problemId = p.id`;
interface SummaryRow extends ProblemRow {
  attemptCount: number;
  submissionId: string | null;
  lastOutcome: Outcome | null;
  submissionHelp: Help;
  submissionLanguage: string;
  submissionSeconds: number | null;
  submissionConfidence: number | null;
  submissionNotes: string;
  lastAttemptAt: string | null;
  submissionReview: string | null;
  lastSolveSeconds: number | null;
  lastSolveHelp: Help | null;
  latestConfidence: number | null;
  nextReviewDate: string | null;
  reviewAction: ReviewTarget['action'] | null;
}
/** Problems as the API shows them, in the order they were added. */
export function problemViews(db: Db, where = '', ...params: (string | number)[]): Problem[] {
  const rows = many<SummaryRow>(db, `${summary} ${where} ORDER BY p.rowid`, ...params);
  const tags = new Map<string, Tag[]>();
  for (const t of many<TagRow & { problemId: string }>(
    db,
    'SELECT t.*, pt.problemId FROM problem_tags pt JOIN tags t ON t.id = pt.tagId ORDER BY pt.rowid',
  ))
    tags.set(t.problemId, [...(tags.get(t.problemId) ?? []), tagView(t)]);
  const projection = listProjection(db);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    slug: r.slug,
    difficulty: r.difficulty,
    notes: r.notes,
    ...(r.leetcodeTopics ? { leetcodeTopics: JSON.parse(r.leetcodeTopics) as string[] } : {}),
    legacyCompleted: !!r.legacyCompleted,
    exposed: !!r.exposed,
    lastAttemptAt: r.lastAttemptAt,
    lastSolveSeconds: r.lastSolveSeconds,
    lastSolveHelp: r.lastSolveHelp,
    lastOutcome: r.lastOutcome,
    nextReviewDate: r.nextReviewDate,
    attemptCount: r.attemptCount,
    reviewAction: r.reviewAction,
    latestSubmission: r.submissionId
      ? {
          id: r.submissionId,
          outcome: r.lastOutcome,
          help: r.submissionHelp,
          language: r.submissionLanguage,
          activeSeconds: r.submissionSeconds,
          confidence: r.submissionConfidence,
          notes: r.submissionNotes,
          finishedAt: r.lastAttemptAt,
          nextReviewDate: r.submissionReview,
        }
      : null,
    latestConfidence: r.latestConfidence,
    tags: tags.get(r.id) ?? [],
    lists: projection.forProblem(r),
    rating: problemRating(db, r),
  }));
}
export function problemView(db: Db, id: string): Problem {
  const [p] = problemViews(db, 'WHERE p.id = ?', id);
  if (!p) throw missing();
  return p;
}
export function problemTags(db: Db, problemId: string): Tag[] {
  return many<TagRow>(
    db,
    'SELECT t.* FROM problem_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.problemId = ? ORDER BY pt.rowid',
    problemId,
  ).map(tagView);
}
export function assignLinks(
  db: Db,
  id: string,
  body: { tags?: { tagId: string }[]; listIds?: string[] },
  display = false,
) {
  if (body.tags) {
    for (const t of body.tags) one(db, 'SELECT 1 FROM tags WHERE id = ?', t.tagId);
    run(db, 'DELETE FROM problem_tags WHERE problemId = ?', id);
    for (const t of body.tags)
      run(db, 'INSERT OR IGNORE INTO problem_tags (problemId, tagId) VALUES (?, ?)', id, t.tagId);
  }
  if (body.listIds) {
    for (const l of body.listIds) one(db, 'SELECT 1 FROM lists WHERE id = ?', l);
    const wanted = new Set(
      display ? listProjection(db).forEdit(getProblem(db, id), body.listIds) : body.listIds,
    );
    const existing = many<{ listId: string }>(
      db,
      'SELECT listId FROM list_memberships WHERE problemId = ?',
      id,
    ).map((r) => r.listId);
    for (const l of existing)
      if (!wanted.has(l))
        run(db, 'DELETE FROM list_memberships WHERE problemId = ? AND listId = ?', id, l);
    for (const l of wanted)
      if (!existing.includes(l))
        run(db, 'INSERT INTO list_memberships (problemId, listId) VALUES (?, ?)', id, l);
  }
}
export function addProblem(
  db: Db,
  body: {
    title: string;
    url: string;
    difficulty?: string | null;
    notes?: string;
    leetcodeTopics?: string[];
  },
): ProblemRow {
  const url = problemUrl.parse(body.url),
    slug = new URL(url).pathname.split('/')[2]!;
  const existing = maybe<ProblemRow>(db, 'SELECT * FROM problems WHERE slug = ?', slug);
  if (existing) return existing;
  const id = randomUUID();
  insert(db, 'problems', {
    id,
    title: body.title,
    url,
    slug,
    difficulty: body.difficulty ?? null,
    notes: body.notes ?? '',
    leetcodeTopics: body.leetcodeTopics ?? null,
  });
  return getProblem(db, id);
}
/** Showing a problem's tags, lists or notes reveals it; later attempts count as retention. */
export function discloseProblem(db: Db, p: Problem): Problem {
  if (!p.exposed) update(db, 'problems', p.id, { exposed: true });
  return { ...p, exposed: true };
}
/** Metadata stays hidden while a mixed (unseen) attempt is in progress. */
export function assertMetadataVisible(db: Db, problemId?: string) {
  if (
    maybe(
      db,
      `SELECT 1 FROM attempts WHERE context = 'mixed' AND status != 'completed' AND (? IS NULL OR problemId = ?)`,
      problemId ?? null,
      problemId ?? null,
    )
  )
    throw new ApiError(
      403,
      'HIDDEN_ASSESSMENT',
      'Complete the mixed assessment before requesting metadata',
    );
}
export const hiddenAssessment = (db: Db) =>
  !!maybe(db, `SELECT 1 FROM attempts WHERE context = 'mixed' AND status != 'completed'`);
