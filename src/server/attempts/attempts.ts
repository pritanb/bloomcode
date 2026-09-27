import { attemptContext } from './attempt-context.js';
import { idempotent } from '../db/idempotency.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { bumpPlan, getItem, linkAttempt } from '../plans/plan-model.js';
import { decisions } from '../topics/topic-model.js';
import { type Db, insert, maybe, run, transaction, update } from '../db/db.js';
import { readSettings } from '../db/settings.js';
import { ApiError, conflict } from '../db/errors.js';
import { assertMetadataVisible, getProblem, hiddenAssessment } from '../catalogue/problem-model.js';
import {
  version,
  studyDate,
  attemptView,
  reflectionSafeView,
  checkVersion,
  getAttempt,
  attempts,
  NEWEST,
} from './attempt-model.js';
export function registerAttempts(app: FastifyInstance, db: Db, clock: () => Date) {
  app.get('/api/attempts', (req) => {
    assertMetadataVisible(db);
    const { q, limit } = z
      .object({
        q: z.string().trim().max(200).default(''),
        limit: z.coerce.number().int().min(1).max(20).default(10),
      })
      .strict()
      .parse(req.query);
    const rows = attempts(
      db,
      `WHERE a.status = 'completed' AND instr(lower(p.title), lower(?)) > 0 ${NEWEST} LIMIT ?`,
      q,
      limit + 1,
    );
    return {
      attempts: rows.slice(0, limit).map((a) => ({
        id: a.id,
        problem: a.problem,
        finishedAt: a.finishedAt,
        outcome: a.outcome,
        help: a.help,
      })),
      hasMore: rows.length > limit,
    };
  });
  app.post('/api/attempts', (req) => {
    const b = z
      .object({
        problemId: z.string(),
        planItemId: z.string().optional(),
        context: z.enum(['mixed', 'targeted', 'review']),
        language: z.string().min(1).max(80).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      if (maybe(db, "SELECT 1 FROM attempts WHERE status != 'completed'"))
        throw conflict('Finish the existing active attempt first');
      const p = getProblem(db, b.problemId),
        now = clock().toISOString();
      // A curriculum assignment is known-topic practice, never unseen mixed evidence.
      if (
        b.context === 'mixed' &&
        b.planItemId &&
        getItem(db, b.planItemId).recommendationKind === 'topic'
      )
        b.context = 'targeted';
      const seen =
        p.exposed ||
        p.legacyCompleted ||
        !!maybe(db, "SELECT 1 FROM attempts WHERE problemId = ? AND status = 'completed'", p.id);
      const id = randomUUID();
      insert(db, 'attempts', {
        id,
        problemId: p.id,
        planItemId: b.planItemId ?? null,
        context: b.context,
        status: 'active',
        version: 1,
        language: b.language ?? 'python',
        activeSeconds: 0,
        startedAt: now,
        studyDate: studyDate(clock(), readSettings(db).timezone),
        runningSince: now,
        lastHeartbeatAt: now,
        help: 'unknown',
        evidence:
          seen || b.context === 'review'
            ? 'retention'
            : b.context === 'mixed'
              ? 'unseen'
              : 'near_transfer',
      });
      update(db, 'problems', p.id, { exposed: true });
      const a = getAttempt(db, id);
      linkAttempt(db, a);
      return attemptView(a);
    });
  });
  app.post<{ Params: { id: string } }>('/api/attempts/:id/cancel', (req) => {
    const b = z.object({ version }).strict().parse(req.body);
    return idempotent(db, `cancel:${req.params.id}`, req.headers['idempotency-key'], b, () => {
      const a = getAttempt(db, req.params.id);
      checkVersion(a, b.version);
      if (a.status === 'completed') throw conflict('Submitted attempts cannot be cancelled');
      if (a.planItemId) {
        const item = getItem(db, a.planItemId);
        update(db, 'plan_items', item.id, { attemptId: null });
        bumpPlan(db, item.planId);
      }
      run(db, 'DELETE FROM attempt_topics WHERE attemptId = ?', a.id);
      run(db, 'DELETE FROM attempts WHERE id = ?', a.id);
      return { cancelled: true };
    });
  });
  app.get<{ Params: { id: string } }>('/api/attempts/:id', (req) => {
    const a = getAttempt(db, req.params.id);
    const hidden = a.status === 'completed' && hiddenAssessment(db);
    const view = reflectionSafeView(a, hidden);
    if (hidden) return view;
    const scoreDecisions = decisions(db, 'WHERE d.attemptId = ? ORDER BY d.rowid', a.id);
    return scoreDecisions.length ? { ...view, scoreDecisions } : view;
  });
  app.get<{ Params: { id: string } }>('/api/attempts/:id/context', (req) =>
    attemptContext(db, req.params.id),
  );
  app.patch<{ Params: { id: string } }>('/api/attempts/:id/draft', (req) => {
    const b = z
      .object({
        version,
        code: z.string().max(1000000).optional(),
        notes: z.string().max(100000).optional(),
        language: z.string().min(1).max(80).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const a = getAttempt(db, req.params.id);
      checkVersion(a, b.version);
      if (a.status === 'completed') throw conflict('Completed answers are immutable');
      update(db, 'attempts', a.id, { ...b, version: a.version + 1 });
      return attemptView(getAttempt(db, a.id));
    });
  });
  app.post<{ Params: { id: string } }>('/api/attempts/:id/timer', (req) => {
    const b = z
      .object({
        version,
        action: z.enum(['pause', 'resume', 'heartbeat']),
        includeGap: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(db, () => {
      const a = getAttempt(db, req.params.id);
      checkVersion(a, b.version);
      if (a.status === 'completed') throw conflict('Attempt already completed');
      const now = clock().toISOString();
      if (a.status === 'active' && a.lastHeartbeatAt) {
        const delta = Math.max(
          0,
          Math.floor((clock().getTime() - Date.parse(a.lastHeartbeatAt)) / 1000),
        );
        if (delta > 120) {
          a.status = 'paused';
          a.runningSince = null;
          a.needsGapDecision = true;
          a.gapSeconds = delta;
        } else {
          a.activeSeconds = (a.activeSeconds ?? 0) + delta;
          a.lastHeartbeatAt = now;
        }
      }
      if (b.action === 'resume') {
        if (a.needsGapDecision && b.includeGap === undefined)
          throw new ApiError(
            400,
            'GAP_DECISION',
            'Choose whether to include the disconnected interval',
          );
        if (a.needsGapDecision && b.includeGap)
          a.activeSeconds =
            (a.activeSeconds ?? 0) +
            Math.max(
              a.gapSeconds,
              Math.floor((clock().getTime() - Date.parse(a.lastHeartbeatAt!)) / 1000),
            );
        a.needsGapDecision = false;
        a.gapSeconds = 0;
        a.status = 'active';
        a.runningSince = now;
        a.lastHeartbeatAt = now;
      } else if (b.action === 'pause') {
        a.status = 'paused';
        a.runningSince = null;
      }
      const { status, runningSince, needsGapDecision, gapSeconds, activeSeconds, lastHeartbeatAt } =
        a;
      update(db, 'attempts', a.id, {
        status,
        runningSince,
        needsGapDecision,
        gapSeconds,
        activeSeconds,
        lastHeartbeatAt,
        version: a.version + 1,
      });
      return attemptView(getAttempt(db, a.id));
    });
  });
}
