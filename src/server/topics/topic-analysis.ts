import { createHash, randomUUID } from 'node:crypto';
import { type Db, many, transaction } from '../db/db.js';
import { learningRecords, putLearningRecord } from '../insights/records.js';
import type { ScoreDecision } from '../../shared/contracts.js';
import { attempts } from '../attempts/attempt-model.js';
import { assertMetadataVisible, hiddenAssessment } from '../catalogue/problem-model.js';
import { decisions, topicRows } from './topic-model.js';
import { conflict, ApiError } from '../db/errors.js';
import {
  topicReason,
  type TopicAnalysisContext,
  type TopicAnalysisRecord,
  type TopicAnalysisStatus,
} from '../../shared/topic-analysis.js';
import { z } from 'zod';

export class TopicAnalysis {
  constructor(
    private db: Db,
    private clock: () => Date,
  ) {}
  topics() {
    return topicRows(this.db)
      .map(({ id, name, score, provisional, lastReviewed }) => ({
        id,
        name,
        score,
        provisional: !!provisional,
        lastReviewed,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  context(): TopicAnalysisContext[] {
    const cutoff = new Date(this.clock().getTime() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const recent = attempts(
      this.db,
      "WHERE a.status = 'completed' AND a.studyDate >= ? ORDER BY a.rowid",
      cutoff,
    );
    const links = many<{ attemptId: string; topicId: string }>(
      this.db,
      'SELECT attemptId, topicId FROM attempt_topics ORDER BY rowid',
    );
    const movements: ScoreDecision[] = decisions(this.db, 'ORDER BY d.rowid');
    return this.topics().map((topic) => {
      const ids = new Set(links.filter((l) => l.topicId === topic.id).map((l) => l.attemptId));
      movements
        .filter((m) => m.topicId === topic.id && m.attemptId)
        .forEach((m) => ids.add(m.attemptId!));
      return {
        ...topic,
        recentAttempts: recent
          .filter((a) => ids.has(a.id))
          .sort((a, b) => b.studyDate.localeCompare(a.studyDate))
          .slice(0, 20)
          .map((a) => ({
            date: a.studyDate,
            outcome: a.outcome,
            help: a.help,
            evidence: a.evidence,
            confidence: a.confidence,
            difficulty: a.problem.difficulty,
            activeSeconds: a.activeSeconds,
          })),
        scoreMovements: movements
          .filter((m) => m.topicId === topic.id && m.date >= cutoff)
          .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))
          .slice(0, 20)
          .map(({ date, oldScore, newScore, attemptId }) => ({
            date,
            oldScore,
            newScore,
            attemptId,
          })),
      };
    });
  }
  private expired(r: TopicAnalysisRecord) {
    return r.status === 'running' && this.clock().getTime() - r.claimedAt >= 240_000;
  }
  fingerprint() {
    return createHash('sha256')
      .update(JSON.stringify({ version: 'topic-focus-v2', topics: this.context() }))
      .digest('hex');
  }
  record(): TopicAnalysisRecord {
    return (
      learningRecords<TopicAnalysisRecord>(this.db, 'topic_analysis')[0] ?? {
        id: 'topic-analysis',
        kind: 'topic_analysis',
        enabled: false,
        fingerprint: '',
        status: 'idle',
        claimId: null,
        claimedAt: 0,
        error: null,
        report: null,
      }
    );
  }
  put(r: TopicAnalysisRecord) {
    return putLearningRecord(this.db, r);
  }
  enable(enabled: boolean) {
    assertMetadataVisible(this.db);
    const r = this.record();
    this.put({ ...r, enabled, claimId: null, status: enabled ? 'pending' : 'idle' });
    return this.status();
  }
  retry() {
    assertMetadataVisible(this.db);
    const r = this.record();
    this.put({ ...r, enabled: true, status: 'pending', claimId: null, error: null });
    return this.status();
  }
  recover() {
    const r = this.record();
    if (r.status === 'running') this.put({ ...r, status: 'pending', claimId: null, claimedAt: 0 });
  }
  claim() {
    assertMetadataVisible(this.db);
    const r = this.record(),
      fingerprint = this.fingerprint();
    // Runs only when the learner asks (Generate or Refresh), never on a schedule.
    if (!r.enabled || !this.topics().length) return null;
    if (r.status !== 'pending' && !this.expired(r)) return null;
    const job = this.put({
      ...r,
      fingerprint,
      status: 'running',
      claimId: randomUUID(),
      claimedAt: this.clock().getTime(),
      error: null,
    });
    return { job, topics: this.context() };
  }
  current(claimId: string) {
    assertMetadataVisible(this.db);
    const r = this.record();
    if (!r.enabled || r.claimId !== claimId || !['running', 'done'].includes(r.status))
      throw conflict('Topic analysis changed; request fresh work');
    return r;
  }
  complete(claimId: string, input: unknown, reasonsInput?: unknown) {
    return transaction(this.db, () => {
      const r = this.current(claimId);
      if (r.status === 'done') return { ok: true };
      const topicIds = z.array(z.string()).max(3).parse(input),
        ids = new Set(this.topics().map((t) => t.id));
      if (
        topicIds.length !== Math.min(3, ids.size) ||
        new Set(topicIds).size !== topicIds.length ||
        topicIds.some((id) => !ids.has(id))
      )
        throw new ApiError(
          400,
          'EVIDENCE',
          'Select three distinct supplied topics (or all topics if fewer than three exist)',
        );
      // Older adapters send selections without reasons; the card then shows links only.
      const reasons =
        reasonsInput === undefined
          ? undefined
          : z.array(topicReason).length(topicIds.length).parse(reasonsInput);
      this.put({
        ...r,
        status: 'done',
        report: {
          fingerprint: r.fingerprint,
          createdAt: this.clock().toISOString(),
          topicIds,
          ...(reasons ? { reasons } : {}),
          topicPriorities: [],
          model: null,
        },
      });
      return { ok: true };
    });
  }
  fail(claimId: string, error: string) {
    const r = this.current(claimId);
    if (r.status !== 'done') this.put({ ...r, status: 'failed', error });
    return { ok: true };
  }
  status(): TopicAnalysisStatus {
    const r = this.record();
    const hidden = hiddenAssessment(this.db);
    const status = !r.enabled ? 'idle' : this.expired(r) ? 'pending' : r.status;
    return {
      enabled: r.enabled,
      hidden,
      topics: this.topics(),
      report: hidden ? null : r.report,
      status,
    };
  }
}
