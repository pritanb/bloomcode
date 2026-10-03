import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { ImportPayload, ImportReport, ImportRecord } from '../../shared/contracts.js';
import { type Db, insert, many, maybe, run, transaction, update } from '../db/db.js';
import { newTagHue } from '../db/tag-colour.js';
import { date, name, addProblem, assignLinks, problemUrl } from './problem-model.js';
import { outcome, help, seconds } from '../attempts/attempt-model.js';
import { updateTarget } from '../attempts/review-schedule.js';
import { canonical } from '../db/idempotency.js';
import { conflict } from '../db/errors.js';
export const score = z
  .number()
  .min(1)
  .max(5)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
    'Scores support two decimal places',
  );
const key = z.string().min(1).max(500);
export const importSchema = z
  .object({
    importId: key,
    dryRun: z.boolean(),
    source: z.object({ retrievedAt: z.iso.datetime({ offset: true }) }).strict(),
    problems: z.array(
      z
        .object({
          key,
          title: name,
          url: z.string(),
          difficulty: z.enum(['Easy', 'Medium', 'Hard']).nullable().optional(),
          notes: z.string().optional(),
          legacyCompleted: z.boolean().optional(),
          exposed: z.boolean().optional(),
          tags: z.array(name).optional(),
          lists: z.array(name).optional(),
          leetcodeTopics: z.array(name).max(30).optional(),
        })
        .strict(),
    ),
    attempts: z.array(
      z
        .object({
          sourceKey: key,
          problemKey: key,
          date,
          outcome,
          help,
          activeSeconds: seconds,
          confidence: z.number().min(1).max(5).nullable().optional(),
          notes: z.string(),
          code: z.string().optional(),
          evidence: z.enum([
            'retention',
            'near_transfer',
            'unseen',
            'mock',
            'legacy',
            'immediate_repair',
          ]),
          nextReviewDate: date.nullable().optional(),
          topicNames: z.array(name).optional(),
        })
        .strict(),
    ),
    topics: z.array(
      z
        .object({
          name,
          score: score.nullable(),
          notes: z.string(),
          lastReviewed: date.nullable().optional(),
          provisional: z.boolean(),
        })
        .strict(),
    ),
    movements: z.array(
      z
        .object({
          sourceKey: key,
          topicName: name,
          problemKey: key.optional(),
          date,
          oldScore: score,
          newScore: score,
          rationale: z.string(),
          evidence: z.string(),
        })
        .strict(),
    ),
    records: z.array(
      z
        .object({
          sourceKey: key,
          tab: z.string(),
          row: z.number().int().min(0),
          raw: z.unknown(),
          status: z.enum(['imported', 'metadata', 'duplicate', 'unresolved']),
          reason: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const named = (db: Db, table: 'tags' | 'lists' | 'topics', value: string) =>
  maybe<{ id: string }>(db, `SELECT id FROM ${table} WHERE lower(name) = lower(?)`, value)?.id;
export function applyImport(db: Db, b: ImportPayload, clock: () => Date): ImportReport {
  const counts: Record<string, number> = {
      problems: 0,
      attempts: 0,
      topics: 0,
      movements: 0,
      records: 0,
    },
    warnings: string[] = [],
    unresolved: ImportRecord[] = b.records.filter((r) => r.status === 'unresolved');
  const fingerprint = createHash('sha256')
      // `planned` was dropped with a retired progress importer; hashing it empty keeps batches
      // applied before then (such as the public lists) replaying as no-ops.
      .update(canonical({ ...b, planned: [], dryRun: false }))
      .digest('hex'),
    prior = maybe<{ fingerprint: string }>(
      db,
      'SELECT fingerprint FROM import_batches WHERE id = ?',
      b.importId,
    );
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw conflict('Import ID already used for different source data');
    return {
      dryRun: b.dryRun,
      counts,
      warnings: ['Import already applied; no records changed'],
      unresolved,
    };
  }
  insert(db, 'import_batches', {
    id: b.importId,
    fingerprint,
    source: b.source,
    appliedAt: clock().toISOString(),
  });
  const problems = new Map<string, string>();
  const unresolvedRow = (sourceKey: string, raw: unknown, reason: string) => {
    const record: ImportRecord = {
      sourceKey,
      tab: 'canonical',
      row: 0,
      raw,
      status: 'unresolved',
      reason,
    };
    unresolved.push(record);
    warnings.push(`${sourceKey}: ${reason}`);
  };
  const seen = new Set<string>();
  for (const input of b.problems) {
    if (seen.has(input.key)) {
      unresolvedRow(input.key, input, 'Duplicate problem key');
      continue;
    }
    seen.add(input.key);
    if (!problemUrl.safeParse(input.url).success) {
      unresolvedRow(input.key, input, 'Unrecognised original LeetCode URL');
      continue;
    }
    const known = !!maybe(
      db,
      'SELECT 1 FROM problems WHERE slug = ?',
      new URL(input.url).pathname.split('/')[2]!,
    );
    const p = addProblem(db, input);
    if (!known) counts.problems!++;
    update(db, 'problems', p.id, {
      difficulty: p.difficulty ?? input.difficulty ?? null,
      notes:
        input.notes?.trim() && !p.notes.includes(input.notes)
          ? [p.notes, input.notes].filter(Boolean).join('\n\n')
          : p.notes,
      legacyCompleted: !!p.legacyCompleted || !!input.legacyCompleted,
      exposed: !!p.exposed || !!input.exposed || !!input.legacyCompleted,
      ...(!p.leetcodeTopics && input.leetcodeTopics
        ? { leetcodeTopics: input.leetcodeTopics }
        : {}),
    });
    problems.set(input.key, p.id);
    const tagIds = (input.tags ?? []).map((n) => {
      const existing = named(db, 'tags', n);
      if (existing) return existing;
      const hues = many<{ hue: number }>(db, 'SELECT hue FROM tags WHERE hue IS NOT NULL');
      return insert(db, 'tags', {
        id: randomUUID(),
        name: n,
        hue: newTagHue(hues.map((t) => t.hue)),
      }).id;
    });
    const listIds = (input.lists ?? []).map(
      (n) =>
        named(db, 'lists', n) ??
        insert(db, 'lists', { id: randomUUID(), name: n, sourceUrl: null, sourceVersion: null }).id,
    );
    const oldTags = many<{ tagId: string }>(
        db,
        'SELECT tagId FROM problem_tags WHERE problemId = ?',
        p.id,
      ),
      oldLists = many<{ listId: string }>(
        db,
        'SELECT listId FROM list_memberships WHERE problemId = ?',
        p.id,
      );
    assignLinks(db, p.id, {
      tags: [...tagIds.map((tagId) => ({ tagId })), ...oldTags],
      listIds: [...listIds, ...oldLists.map((l) => l.listId)],
    });
  }
  const topics = new Map<string, string>();
  for (const input of b.topics) {
    let id = named(db, 'topics', input.name);
    if (!id) {
      id = insert(db, 'topics', {
        id: randomUUID(),
        name: input.name,
        score: input.score,
        version: 1,
        notes: input.notes,
        lastReviewed: input.lastReviewed ?? null,
        provisional: input.provisional,
      }).id;
      counts.topics!++;
    } else warnings.push(`Existing topic ${input.name} retained; no score overwrite`);
    topics.set(input.name.toLowerCase(), id);
  }
  const attemptKeys = new Set<string>();
  for (const input of [...b.attempts].sort((a, b) => a.date.localeCompare(b.date))) {
    const problemId = problems.get(input.problemKey);
    if (!problemId || attemptKeys.has(input.sourceKey)) {
      unresolvedRow(
        input.sourceKey,
        input,
        !problemId ? 'Unresolved problem reference' : 'Duplicate attempt source key',
      );
      continue;
    }
    attemptKeys.add(input.sourceKey);
    const { last } = maybe<{ last: string | null }>(
      db,
      "SELECT max(substr(finishedAt, 1, 10)) AS last FROM attempts WHERE problemId = ? AND status = 'completed'",
      problemId,
    )!;
    const id = randomUUID();
    insert(db, 'attempts', {
      id,
      problemId,
      context: 'review',
      status: 'completed',
      version: 1,
      language: 'python',
      code: input.code ?? '',
      notes: input.notes,
      activeSeconds: input.activeSeconds,
      startedAt: input.date,
      finishedAt: input.date,
      studyDate: input.date,
      outcome: input.outcome,
      help: input.help,
      evidence: input.evidence,
      confidence: input.confidence ?? null,
      nextReviewDate: input.nextReviewDate ?? null,
      sourceKey: input.sourceKey,
      importId: b.importId,
    });
    update(db, 'problems', problemId, { exposed: true });
    if (input.nextReviewDate && (!last || input.date >= last))
      updateTarget(db, problemId, input.nextReviewDate, 'legacy-candidate');
    for (const n of input.topicNames ?? []) {
      const topicId = topics.get(n.toLowerCase());
      if (topicId)
        run(
          db,
          'INSERT OR IGNORE INTO attempt_topics (attemptId, topicId) VALUES (?, ?)',
          id,
          topicId,
        );
      else warnings.push(`Unknown topic ${n} for ${input.sourceKey}`);
    }
    counts.attempts!++;
  }
  const movementKeys = new Set<string>();
  for (const input of b.movements) {
    const topicId = topics.get(input.topicName.toLowerCase());
    if (!topicId || movementKeys.has(input.sourceKey)) {
      unresolvedRow(input.sourceKey, input, 'Unresolved topic or duplicate movement');
      continue;
    }
    movementKeys.add(input.sourceKey);
    insert(db, 'score_decisions', {
      id: randomUUID(),
      topicId,
      attemptId: null,
      oldScore: input.oldScore,
      newScore: input.newScore,
      rationale: input.rationale,
      evidence: input.evidence,
      date: input.date,
      recordedAt: b.source.retrievedAt,
      sourceKey: input.sourceKey,
      importId: b.importId,
    });
    counts.movements!++;
  }
  for (const r of [...b.records, ...unresolved.filter((r) => r.tab === 'canonical')]) {
    insert(db, 'import_records', {
      id: randomUUID(),
      ...r,
      raw: r.raw ?? null,
      importId: b.importId,
    });
    counts.records!++;
  }
  return { dryRun: b.dryRun, counts, warnings, unresolved };
}
export function registerImport(app: FastifyInstance, db: Db, clock: () => Date) {
  app.post('/api/import', (req) => {
    const b = importSchema.parse(req.body);
    let report: ImportReport | undefined;
    const rollback = Symbol('dry-run');
    try {
      return transaction(db, () => {
        report = applyImport(db, b, clock);
        if (b.dryRun) throw rollback;
        return report;
      });
    } catch (error) {
      if (error === rollback) return report;
      throw error;
    }
  });
}
