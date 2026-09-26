// Problems with their tags and lists, and the shared validation and visibility rules.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Problem, ReviewTarget, Tag } from '../../shared/contracts.js';
import type { Store } from '../db/store.js';
import { ApiError } from '../db/errors.js';
import { newestAttempt, type AttemptRecord } from '../attempts/attempt-model.js';
import { listProjection, type ListLink } from './list-projection.js';
export const name = z.string().trim().min(1).max(300);
export const date = z.iso.date();
export const problemUrl = z
  .string()
  .max(2048)
  .regex(
    /^https:\/\/(?:www\.)?leetcode\.(?:com|cn)\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:description|editorial|solutions|submissions))?\/?(?:\?[^\s#\\]*)?(?:#[^\s\\]*)?$/,
    'Expected an unmodified HTTPS LeetCode problem URL',
  );
export interface TagLink {
  id: string;
  problemId: string;
  tagId: string;
}
export function tagView(tag: Tag): Tag {
  const { id, name, description, archived, hue } = tag;
  return {
    id,
    name,
    description,
    archived,
    kind: tag.kind ?? 'pattern',
    ...(hue === undefined ? {} : { hue }),
  };
}
export function problemView(s: Store, p: Problem, projection = listProjection(s)): Problem {
  const completed = s
    .all<AttemptRecord>('attempts')
    .filter((a) => a.problemId === p.id && a.status === 'completed')
    .sort(newestAttempt);
  const a = completed[0];
  const latestSubmission = a
    ? {
        id: a.id,
        outcome: a.outcome,
        help: a.help,
        language: a.language,
        activeSeconds: a.activeSeconds,
        confidence: a.confidence,
        notes: a.notes,
        finishedAt: a.finishedAt,
        nextReviewDate: a.nextReviewDate,
      }
    : null;
  return {
    ...p,
    reviewAction:
      s.all<ReviewTarget>('review_targets').find((t) => t.problemId === p.id)?.action ?? null,
    latestSubmission,
    latestConfidence: completed.find((a) => a.confidence != null)?.confidence ?? null,
    tags: s
      .all<TagLink>('problem_tags')
      .filter((r) => r.problemId === p.id)
      .map((r) => tagView(s.get<Tag>('tags', r.tagId))),
    lists: projection.forProblem(p),
  };
}
export function assignLinks(
  s: Store,
  id: string,
  body: { tags?: { tagId: string }[]; listIds?: string[] },
  display = false,
) {
  if (body.tags) {
    for (const t of body.tags) s.get('tags', t.tagId);
    for (const r of s.all<TagLink>('problem_tags').filter((r) => r.problemId === id))
      s.remove('problem_tags', r.id);
    for (const t of body.tags)
      s.put('problem_tags', {
        id: `${id}:${t.tagId}`,
        problemId: id,
        tagId: t.tagId,
      });
  }
  if (body.listIds) {
    for (const l of body.listIds) s.get('lists', l);
    const wanted = new Set(
      display
        ? listProjection(s).forEdit(s.get<Problem>('problems', id), body.listIds)
        : body.listIds,
    );
    const existing = s.all<ListLink>('list_memberships').filter((r) => r.problemId === id);
    for (const r of existing) if (!wanted.has(r.listId)) s.remove('list_memberships', r.id);
    for (const l of wanted)
      if (!existing.some((r) => r.listId === l))
        s.put('list_memberships', { id: `${id}:${l}`, problemId: id, listId: l });
  }
}
export function addProblem(
  s: Store,
  body: {
    title: string;
    url: string;
    difficulty?: string | null;
    notes?: string;
    leetcodeTopics?: string[];
  },
): Problem {
  const url = problemUrl.parse(body.url),
    slug = new URL(url).pathname.split('/')[2]!;
  const existing = s.all<Problem>('problems').find((p) => p.slug === slug);
  if (existing) return existing;
  return s.put('problems', {
    id: randomUUID(),
    title: body.title,
    url,
    slug,
    difficulty: body.difficulty ?? null,
    notes: body.notes ?? '',
    ...(body.leetcodeTopics ? { leetcodeTopics: body.leetcodeTopics } : {}),
    tags: [],
    lists: [],
    legacyCompleted: false,
    exposed: false,
    lastAttemptAt: null,
    lastSolveSeconds: null,
    lastSolveHelp: null,
    lastOutcome: null,
    nextReviewDate: null,
    attemptCount: 0,
  } satisfies Problem);
}
export function discloseProblem(s: Store, p: Problem, clock: () => Date): Problem {
  if (!p.exposed) {
    s.put('problems', { ...s.get<Problem>('problems', p.id), exposed: true });
    s.put('audit_events', {
      id: randomUUID(),
      action: 'disclose_problem',
      problemId: p.id,
      recordedAt: clock().toISOString(),
    });
  }
  return { ...p, exposed: true };
}
export function assertMetadataVisible(s: Store, problemId?: string) {
  if (
    s
      .all<AttemptRecord>('attempts')
      .some(
        (a) =>
          a.context === 'mixed' &&
          a.status !== 'completed' &&
          (!problemId || a.problemId === problemId),
      )
  )
    throw new ApiError(
      403,
      'HIDDEN_ASSESSMENT',
      'Complete the mixed assessment before requesting metadata',
    );
}
