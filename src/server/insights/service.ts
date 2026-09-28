import { createHash, randomUUID } from 'node:crypto';
import { type Db, insert, many, maybe, one, run, transaction, update } from '../db/db.js';
import { insightsEnabled } from '../db/settings.js';
import { type AttemptRecord, attempts, getAttempt, NEWEST } from '../attempts/attempt-model.js';
import {
  ANALYSIS_VERSION,
  REPORT_VERSION,
  EMBEDDING_MODEL,
  EMBEDDING_REVISION,
  extractionResult,
  targetedReportResult,
  type Correction,
  type InsightJob,
  type InsightReport,
  type Observation,
  type InsightStatus,
} from '../../shared/insights.js';
import {
  assertMetadataVisible,
  discloseProblem,
  hiddenAssessment,
  problemView,
  type TagRow,
} from '../catalogue/problem-model.js';
import { conflict, ApiError, missing } from '../db/errors.js';
import { keywordScore, rank } from './retrieval.js';
import type { Embed } from './embeddings.js';
export const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function source(a: AttemptRecord) {
  return {
    code: a.code,
    notes: a.notes,
    takeaway: a.takeaway ?? '',
    mistakeLabels: (a.mistakeLabels ?? []).join(', '),
    outcome: a.outcome ?? 'unknown',
    help: a.help,
    confidence: a.confidence === null ? 'unknown' : String(a.confidence),
  };
}
export const fingerprint = (a: AttemptRecord) =>
  hash({
    version: ANALYSIS_VERSION,
    ...source(a),
    language: a.language,
    evidence: a.evidence,
    finishedAt: a.finishedAt,
    problem: a.problem,
    feedback: a.feedback,
    activeSeconds: a.activeSeconds,
  });
const modelKey = `${EMBEDDING_MODEL}@${EMBEDDING_REVISION}:q8:mean`;
// Reports may take two long calls (Codex at high effort), so they get a longer lease.
export const leaseMs = (job: { attemptId: string | null }) => (job.attemptId ? 240_000 : 600_000);
// Rows read back in the shape (and key order) the API, reports and fingerprints have always used.
const OBSERVATIONS = `SELECT o.id, 'observation' AS kind, o.summary, o.polarity, o.evidenceType,
    o.sourceField, o.excerpt, o.attemptId, a.problemId, o.fingerprint, o.createdAt,
    o.analysisVersion, o.model
  FROM insight_observations o JOIN attempts a ON a.id = o.attemptId`;
const CORRECTIONS = `SELECT 'correction-' || c.observationId AS id, 'correction' AS kind, c.observationId,
    o.attemptId, o.summary, o.sourceField, o.excerpt, c.reason, c.createdAt
  FROM insight_corrections c JOIN insight_observations o ON o.id = c.observationId`;
/** Pairs of (attempt ID, fingerprint) passed as JSON: the current version of each completed attempt. */
const CURRENT = '(SELECT value ->> 0, value ->> 1 FROM json_each(?))';
type JobRow = Omit<InsightJob, 'evidenceIds' | 'questionIds'> & {
  evidenceIds: string;
  questionIds: string;
};
const jobView = (j: JobRow): InsightJob => ({
  ...j,
  evidenceIds: JSON.parse(j.evidenceIds) as string[],
  questionIds: JSON.parse(j.questionIds) as string[],
});
type ReportRow = Omit<InsightReport, 'kind' | 'findings' | 'topicPriorities' | 'evidenceIds'> & {
  findings: string;
  topicPriorities: string | null;
  evidenceIds: string;
};
const reportView = ({ id, findings, topicPriorities, ...r }: ReportRow): InsightReport => ({
  id,
  kind: 'report',
  findings: JSON.parse(findings) as InsightReport['findings'],
  ...(topicPriorities
    ? { topicPriorities: JSON.parse(topicPriorities) as InsightReport['topicPriorities'] }
    : {}),
  ...r,
  evidenceIds: JSON.parse(r.evidenceIds) as string[],
});
export class Insights {
  reportActivity: string | null = null;
  embeddingStatus: InsightStatus['embeddingStatus'] = 'idle';
  error: string | null = null;
  /** A learning report can only be claimed once local search is ready. */
  onEmbeddingsReady = () => {};
  private busy = false;
  private stopped = false;
  private refreshing: Promise<void> | undefined;
  private again = false;
  constructor(
    readonly db: Db,
    readonly clock: () => Date,
    readonly embed: Embed,
  ) {}
  enabled() {
    return insightsEnabled(this.db);
  }
  attempts() {
    return attempts(this.db, `WHERE a.status = 'completed' ${NEWEST}`);
  }
  /** Each completed attempt's [ID, fingerprint], newest first; passed to CURRENT as JSON. */
  current() {
    return this.attempts().map((a) => [a.id, fingerprint(a)]);
  }
  jobs() {
    return many<JobRow>(this.db, 'SELECT * FROM insight_jobs ORDER BY rowid').map(jobView);
  }
  job(id: string) {
    const j = maybe<JobRow>(this.db, 'SELECT * FROM insight_jobs WHERE id = ?', id);
    return j && jobView(j);
  }
  /** Queue fresh work for [id, attemptId, fingerprint] jobs, unless the job already has that fingerprint. */
  private queue(jobs: [string, string | null, string][]) {
    run(
      this.db,
      `INSERT INTO insight_jobs (id, attemptId, fingerprint)
       SELECT value ->> 0, value ->> 1, value ->> 2 FROM json_each(?) WHERE true
       ON CONFLICT (id) DO UPDATE SET fingerprint = excluded.fingerprint, status = 'pending',
         claimId = NULL, claimedAt = 0, error = NULL, model = NULL, durationMs = 0, limitation = '',
         evidenceIds = '[]', questionIds = '[]'
       WHERE fingerprint != excluded.fingerprint`,
      JSON.stringify(jobs),
    );
  }
  /** Hand interrupted claims out again (at startup) or retry failed jobs. */
  requeue(status: 'running' | 'failed') {
    run(
      this.db,
      "UPDATE insight_jobs SET status = 'pending', claimId = NULL, claimedAt = 0, error = NULL WHERE status = ?",
      status,
    );
  }
  corrections(attemptId?: string) {
    return many<Correction>(
      this.db,
      `${CORRECTIONS} ${attemptId ? 'WHERE o.attemptId = ?' : ''} ORDER BY c.rowid`,
      ...(attemptId ? [attemptId] : []),
    );
  }
  /** Observations of each attempt's current version that the learner has not dismissed. */
  observations(id?: string) {
    return many<Observation>(
      this.db,
      `${OBSERVATIONS}
       WHERE (o.attemptId, o.fingerprint) IN ${CURRENT} ${id ? 'AND o.id = ?' : ''}
         AND NOT EXISTS (
           SELECT 1 FROM insight_corrections c JOIN insight_observations d ON d.id = c.observationId
           WHERE d.attemptId = o.attemptId AND d.sourceField = o.sourceField AND d.excerpt = o.excerpt)
       ORDER BY o.rowid`,
      JSON.stringify(this.current()),
      ...(id ? [id] : []),
    );
  }
  reconcile() {
    if (!this.enabled()) return;
    this.queue(this.attempts().map((a) => [`attempt-${a.id}`, a.id, fingerprint(a)]));
  }
  coverage() {
    const current = this.current();
    return {
      total: current.length,
      analyzed: one<{ n: number }>(
        this.db,
        `SELECT count(*) AS n FROM insight_jobs
         WHERE status = 'done' AND (attemptId, fingerprint) IN ${CURRENT}`,
        JSON.stringify(current),
      ).n,
    };
  }
  catalogue() {
    const patterns = new Map<string, TagRow[]>();
    for (const t of many<TagRow & { problemId: string }>(
      this.db,
      'SELECT t.*, pt.problemId FROM problem_tags pt JOIN tags t ON t.id = pt.tagId WHERE NOT t.archived ORDER BY pt.rowid',
    ))
      patterns.set(t.problemId, [...(patterns.get(t.problemId) ?? []), t]);
    return many<{
      id: string;
      title: string;
      difficulty: string | null;
      leetcodeTopics: string | null;
    }>(this.db, 'SELECT id, title, difficulty, leetcodeTopics FROM problems ORDER BY rowid').map(
      (p) => ({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty,
        topics: p.leetcodeTopics ? (JSON.parse(p.leetcodeTopics) as string[]) : [],
        patterns: (patterns.get(p.id) ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          notes: t.patternNotes.slice(0, 1200),
          recognitionCues: t.recognitionCues.slice(0, 600),
          pitfalls: t.pitfalls.slice(0, 600),
        })),
      }),
    );
  }

  corpusFingerprint() {
    return hash({
      reportVersion: REPORT_VERSION,
      modelKey,
      attempts: this.attempts().map((a) => [a.id, fingerprint(a)]),
      observations: this.observations(),
      corrections: this.corrections(),
      catalogue: this.catalogue(),
    });
  }
  latestReport() {
    const r = maybe<ReportRow>(
      this.db,
      'SELECT * FROM insight_reports ORDER BY createdAt DESC, id DESC LIMIT 1',
    );
    return r ? reportView(r) : null;
  }
  /** Queue new attempts and embed new observations until none is left. Runs at
   * startup and after each write; a call during a run triggers one more pass. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        while (await this.tick());
      } while (this.again && !this.stopped);
    })().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }
  /** One step of refresh(): embeds up to 16 observations. Returns whether more may remain. */
  async tick(): Promise<boolean> {
    if (this.stopped || this.busy || !this.enabled()) return false;
    this.reconcile();
    if (this.embeddingStatus === 'failed') return false;
    this.busy = true;
    try {
      this.reconcile();
      const wasReady = this.embeddingStatus === 'ready';
      const rows = this.observations();
      const unembedded = rows
        .filter(
          (r) =>
            !maybe(
              this.db,
              'SELECT id FROM insight_embeddings WHERE id = ? AND fingerprint = ? AND model = ?',
              r.id,
              r.fingerprint,
              modelKey,
            ),
        )
        .slice(0, 16);
      if (wasReady && !unembedded.length) return false;
      this.embeddingStatus = 'loading';
      // An empty warm-up downloads/loads the model even before tutor observations exist.
      const vectors = await this.embed(unembedded.map((r) => r.summary));
      if (this.stopped) return false;
      if (
        vectors.length !== unembedded.length ||
        vectors.some((v) => v.length !== 384 || v.some((n) => !Number.isFinite(n)))
      )
        throw Error('Embedding model returned invalid vectors');
      transaction(this.db, () =>
        unembedded.forEach((r, i) =>
          this.db
            .prepare(
              'INSERT OR REPLACE INTO insight_embeddings (id,fingerprint,model,vector) VALUES (?,?,?,?)',
            )
            .run(r.id, r.fingerprint, modelKey, JSON.stringify(vectors[i])),
        ),
      );
      this.embeddingStatus = 'ready';
      this.error = null;
      this.onEmbeddingsReady();
      return unembedded.length > 0;
    } catch (error) {
      if (!this.stopped) {
        this.embeddingStatus = 'failed';
        this.error = (error instanceof Error ? error.message : 'Embedding failed').slice(0, 1000);
      }
      return false;
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.stopped = true;
  }
  vectors() {
    return new Map(
      many<{ id: string; vector: string }>(
        this.db,
        'SELECT id, vector FROM insight_embeddings WHERE model = ?',
        modelKey,
      ).map((r) => [r.id, JSON.parse(r.vector) as number[]]),
    );
  }
  async retrieval(query: string, limit = 12) {
    assertMetadataVisible(this.db);
    const rows = this.observations(),
      vectors = this.vectors();
    const [vector] = await this.embed([query]);
    assertMetadataVisible(this.db);
    return rank(
      query,
      vector,
      this.observations().filter((o) => rows.some((r) => r.id === o.id)),
      vectors,
    ).slice(0, limit);
  }
  reportContext() {
    const rows = this.observations(),
      vectors = this.vectors(),
      selected = new Map<string, Observation>();
    // Include recent anchors from both polarities and retrieved neighbours across
    // the entire history. Counts below describe coverage, not prevalence estimates.
    const attemptDates = new Map(this.attempts().map((a) => [a.id, a.finishedAt ?? a.studyDate]));
    const recent = [...rows].sort(
      (a, b) =>
        (attemptDates.get(b.attemptId) ?? '').localeCompare(attemptDates.get(a.attemptId) ?? '') ||
        a.id.localeCompare(b.id),
    );
    const anchors = [
      ...recent.filter((o) => o.polarity === 'difficulty').slice(0, 6),
      ...recent.filter((o) => o.polarity === 'strength').slice(0, 6),
    ];
    for (const anchor of anchors) selected.set(anchor.id, anchor);
    for (const anchor of anchors) {
      const neighbours = rank(anchor.summary, vectors.get(anchor.id) ?? [], rows, vectors);
      for (const r of neighbours.slice(0, 5)) selected.set(r.id, r);
      // Explicitly seek contrary evidence and earlier attempts on the same problem.
      for (const r of neighbours.filter((o) => o.polarity !== anchor.polarity).slice(0, 2))
        selected.set(r.id, r);
      for (const r of neighbours
        .filter((o) => o.problemId === anchor.problemId && o.attemptId !== anchor.attemptId)
        .slice(0, 2))
        selected.set(r.id, r);
    }
    let evidenceChars = 0;
    const evidence = [...selected.values()]
      .filter((o) => {
        const size = JSON.stringify(o).length;
        if (evidenceChars + size > 30000) return false;
        evidenceChars += size;
        return true;
      })
      .slice(0, 80);
    const query = anchors.map((o) => o.summary).join(' ');
    let questionChars = 0;
    const questions = this.catalogue()
      .sort(
        (a, b) =>
          keywordScore(query, JSON.stringify(b)) - keywordScore(query, JSON.stringify(a)) ||
          a.id.localeCompare(b.id),
      )
      .filter((q) => {
        const size = JSON.stringify(q).length;
        if (questionChars + size > 16000) return false;
        questionChars += size;
        return true;
      })
      .slice(0, 20);
    const attempts = new Map(this.attempts().map((a) => [a.id, a]));
    return {
      reportVersion: REPORT_VERSION,
      ...this.coverage(),
      observationCount: rows.length,
      retrievedCount: evidence.length,
      evidence: evidence.map((o) => ({
        ...o,
        problemTitle: attempts.get(o.attemptId)!.problem.title,
        studyDate: attempts.get(o.attemptId)!.studyDate,
        help: attempts.get(o.attemptId)!.help,
        outcome: attempts.get(o.attemptId)!.outcome,
        evidence: attempts.get(o.attemptId)!.evidence,
      })),
      questions,
      limitations: many<{ attemptId: string | null; limitation: string }>(
        this.db,
        `SELECT attemptId, limitation FROM insight_jobs
         WHERE status = 'done' AND limitation != '' ORDER BY rowid LIMIT 20`,
      ),
    };
  }
  claim() {
    assertMetadataVisible(this.db);
    if (!this.enabled()) return null;
    this.reconcile();
    const fp = this.corpusFingerprint();
    // A report running on evidence that has since changed starts again.
    if (this.job('report-job')?.status === 'running') this.queue([['report-job', null, fp]]);
    const now = this.clock().getTime(),
      jobs = this.jobs();
    if (jobs.some((j) => j.status === 'running' && now - j.claimedAt < leaseMs(j))) return null;
    const pending = many<JobRow>(
      this.db,
      `SELECT j.* FROM insight_jobs j JOIN attempts a ON a.id = j.attemptId
       WHERE j.status IN ('pending', 'running') ${NEWEST}`,
    ).map(jobView);
    const coverage = this.coverage(),
      report = this.latestReport();
    const oldReportJob = jobs.find((j) => j.id === 'report-job');
    const vectors = this.vectors();
    const allEmbedded = this.observations().every((o) => vectors.has(o.id));
    const shouldReport =
      coverage.analyzed > 0 &&
      report?.fingerprint !== fp &&
      this.embeddingStatus === 'ready' &&
      allEmbedded &&
      (!pending.length || coverage.analyzed - (report?.analyzed ?? 0) >= 10);
    let job: InsightJob | undefined;
    if (shouldReport && !(oldReportJob?.fingerprint === fp && oldReportJob.status === 'failed')) {
      this.queue([['report-job', null, fp]]);
      job = this.job('report-job');
    } else job = pending[0];
    if (!job) return null;
    const context = job.attemptId ? this.extractionContext(job.attemptId) : this.reportContext();
    const reportContext = context as ReturnType<Insights['reportContext']>;
    const claim = {
      status: 'running' as const,
      claimId: randomUUID(),
      claimedAt: now,
      error: null,
      ...(!job.attemptId
        ? {
            evidenceIds: reportContext.evidence.map((o) => o.id),
            questionIds: reportContext.questions.map((q) => q.id),
          }
        : {}),
    };
    update(this.db, 'insight_jobs', job.id, claim);
    return { job: { ...job, ...claim }, context };
  }
  extractionContext(attemptId: string) {
    const a = getAttempt(this.db, attemptId);
    // Explicit limits prevent a large imported answer from overflowing the tutor.
    return {
      attemptId: a.id,
      problem: a.problem,
      language: a.language,
      studyDate: a.studyDate,
      evidence: a.evidence,
      ...source(a),
      code: a.code.slice(0, 30000),
      notes: a.notes.slice(0, 10000),
      feedback: a.feedback?.slice(0, 4000) ?? null,
      activeSeconds: a.activeSeconds,
      truncated: a.code.length > 30000 || a.notes.length > 10000,
      corrections: this.corrections(a.id),
    };
  }
  reportAttempt(id: string, claimId: string, attemptId: string) {
    const job = this.currentJob(id, claimId);
    if (
      job.attemptId ||
      !this.observations().some((o) => o.attemptId === attemptId && job.evidenceIds.includes(o.id))
    )
      throw new ApiError(403, 'EVIDENCE', 'Attempt is outside the claimed report evidence');
    const attempt = getAttempt(this.db, attemptId);
    if (attempt.status !== 'completed')
      throw new ApiError(403, 'EVIDENCE', 'Only completed attempts may be inspected');
    return {
      id: attempt.id,
      language: attempt.language,
      studyDate: attempt.studyDate,
      status: attempt.status,
      evidence: attempt.evidence,
      ...source(attempt),
    };
  }
  currentJob(id: string, claimId: string) {
    assertMetadataVisible(this.db);
    const job = this.job(id);
    if (!job) throw missing();
    if (job.claimId !== claimId || !this.enabled())
      throw conflict('This analysis claim is no longer current');
    const fp = job.attemptId
      ? fingerprint(getAttempt(this.db, job.attemptId))
      : this.corpusFingerprint();
    if (job.fingerprint !== fp) throw conflict('Evidence changed; request a new analysis');
    if (!['running', 'done'].includes(job.status)) throw conflict('Analysis is not running');
    return job;
  }
  complete(id: string, claimId: string, result: unknown, model: string | null) {
    return transaction(this.db, () => {
      const job = this.currentJob(id, claimId);
      if (job.status === 'done') return { ok: true };
      let limitation = job.limitation;
      if (job.attemptId) {
        const data = extractionResult.parse(result),
          a = getAttempt(this.db, job.attemptId),
          fields = source(a),
          context = this.extractionContext(a.id);
        for (const o of data.observations) {
          const provided = String(context[o.sourceField as keyof typeof context] ?? '');
          if (!fields[o.sourceField].includes(o.excerpt) || !provided.includes(o.excerpt))
            throw new ApiError(
              400,
              'EVIDENCE',
              'Observation excerpt must occur in the supplied source field',
            );
          const expected =
            o.sourceField === 'code'
              ? 'code_inferred'
              : ['notes', 'takeaway', 'mistakeLabels'].includes(o.sourceField)
                ? 'learner_reported'
                : 'outcome_observed';
          if (o.evidenceType !== expected)
            throw new ApiError(400, 'EVIDENCE', 'Evidence type does not match its source');
          const id = hash([a.id, job.fingerprint, o]);
          const dismissed = context.corrections.some(
            (c) => c.sourceField === o.sourceField && c.excerpt === o.excerpt,
          );
          if (!dismissed && !maybe(this.db, 'SELECT 1 FROM insight_observations WHERE id = ?', id))
            insert(this.db, 'insight_observations', {
              id,
              attemptId: a.id,
              fingerprint: job.fingerprint,
              ...o,
              createdAt: this.clock().toISOString(),
              analysisVersion: ANALYSIS_VERSION,
              model,
            });
        }
        limitation = (
          (context.truncated ? 'Source was truncated to the analysis context limit. ' : '') +
          data.limitation
        ).slice(0, 1000);
      } else {
        const data = targetedReportResult.parse(result),
          observations = new Map(this.observations().map((o) => [o.id, o]));
        for (const finding of data.findings) {
          const evidence = finding.evidenceIds.map((id) => observations.get(id));
          if (evidence.some((o) => !o || !job.evidenceIds.includes(o.id)))
            throw new ApiError(
              400,
              'EVIDENCE',
              'Finding must cite retrieved, current observations',
            );
          if (finding.suggestions.some((q) => !job.questionIds.includes(q.problemId)))
            throw new ApiError(400, 'EVIDENCE', 'Suggestion was not in the supplied catalogue');
          if (
            finding.kind === 'recurring' &&
            new Set(evidence.filter((o) => o?.polarity === 'difficulty').map((o) => o!.problemId))
              .size < 2
          )
            throw new ApiError(
              400,
              'EVIDENCE',
              'Recurring issues require difficulties across two different problems',
            );
          if (
            finding.kind === 'single_problem' &&
            new Set(evidence.map((o) => o!.problemId)).size !== 1
          )
            throw new ApiError(400, 'EVIDENCE', 'Single-problem findings must cite one problem');
          if (finding.kind === 'improvement') {
            const attempts = new Map(this.attempts().map((a) => [a.id, a]));
            const comparable = evidence.some(
              (before) =>
                before!.polarity === 'difficulty' &&
                evidence.some((after) => {
                  const a = attempts.get(before!.attemptId)!,
                    b = attempts.get(after!.attemptId)!;
                  return (
                    after!.polarity === 'strength' &&
                    a.problemId === b.problemId &&
                    a.language === b.language &&
                    a.help === b.help &&
                    a.evidence === b.evidence &&
                    a.studyDate < b.studyDate
                  );
                }),
            );
            if (!comparable)
              throw new ApiError(
                400,
                'EVIDENCE',
                'Improvement needs earlier difficulty and later strength on a comparable attempt at the same problem',
              );
          }
        }
        insert(this.db, 'insight_reports', {
          id: randomUUID(),
          ...data,
          createdAt: this.clock().toISOString(),
          fingerprint: job.fingerprint,
          ...this.coverage(),
          evidenceIds: job.evidenceIds,
          model,
          analysisVersion: ANALYSIS_VERSION,
          durationMs: Math.max(0, this.clock().getTime() - job.claimedAt),
        });
      }
      update(this.db, 'insight_jobs', job.id, {
        status: 'done',
        model,
        durationMs: Math.max(0, this.clock().getTime() - job.claimedAt),
        limitation,
      });
      return { ok: true };
    });
  }
  fail(id: string, claimId: string, error: string) {
    const job = this.currentJob(id, claimId);
    if (job.status !== 'done')
      update(this.db, 'insight_jobs', job.id, {
        status: 'failed',
        error,
        durationMs: Math.max(0, this.clock().getTime() - job.claimedAt),
      });
  }
  dismiss(id: string, reason: string) {
    assertMetadataVisible(this.db);
    if (!this.observations(id).length)
      throw conflict('Observation is already dismissed or outdated');
    insert(this.db, 'insight_corrections', {
      observationId: id,
      reason,
      createdAt: this.clock().toISOString(),
    });
  }
  status(discloseSuggestions = true): Omit<InsightStatus, 'tutorConnected'> {
    const hidden = hiddenAssessment(this.db);
    const jobs = this.jobs(),
      coverage = this.coverage(),
      report = this.latestReport(),
      active = this.observations();
    const reportJob = jobs.find((j) => j.id === 'report-job'),
      currentFingerprint = this.corpusFingerprint();
    const stale = !!report && report.fingerprint !== currentFingerprint;
    const versions = new Map(this.attempts().map((a) => [a.id, fingerprint(a)]));
    const running = jobs
      .filter(
        (j) =>
          j.status === 'running' &&
          j.fingerprint === (j.attemptId ? versions.get(j.attemptId) : currentFingerprint),
      )
      .sort((a, b) => b.claimedAt - a.claimedAt)[0];
    const now = this.clock().getTime();
    const worker = {
      activeKind: running ? (running.attemptId ? ('attempt' as const) : ('report' as const)) : null,
      startedAt: running ? new Date(running.claimedAt).toISOString() : null,
      expiresAt: running ? new Date(running.claimedAt + leaseMs(running)).toISOString() : null,
      timedOut: !!running && now - running.claimedAt >= leaseMs(running),
    };
    const reportStatus: InsightStatus['reportStatus'] =
      hidden || !this.enabled()
        ? 'idle'
        : reportJob?.fingerprint === currentFingerprint &&
            reportJob.status === 'running' &&
            this.clock().getTime() - reportJob.claimedAt < leaseMs(reportJob)
          ? 'generating'
          : reportJob?.fingerprint === currentFingerprint && reportJob.status === 'failed'
            ? 'failed'
            : report && !stale
              ? 'ready'
              : coverage.analyzed > 0
                ? 'waiting'
                : 'idle';
    const ids = new Set(active.map((o) => o.id));
    // Remove invalidated findings immediately; an older report must never repeat a correction.
    const visible = report
      ? {
          ...report,
          findings: report.findings.filter((f) => f.evidenceIds.every((id) => ids.has(id))),
        }
      : null;
    const referenced = new Set(visible?.findings.flatMap((f) => f.evidenceIds) ?? []);
    const topicTags = new Map<string, string[]>();
    for (const t of many<{ problemId: string; name: string }>(
      this.db,
      "SELECT pt.problemId, t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tagId WHERE t.kind = 'topic' AND NOT t.archived ORDER BY pt.rowid",
    ))
      topicTags.set(t.problemId, [...(topicTags.get(t.problemId) ?? []), t.name]);
    const problemTopics = new Map(
      many<{ id: string; leetcodeTopics: string | null }>(
        this.db,
        'SELECT id, leetcodeTopics FROM problems',
      ).map((p) => {
        const names = [
          ...(p.leetcodeTopics ? (JSON.parse(p.leetcodeTopics) as string[]) : []),
          ...(topicTags.get(p.id) ?? []),
        ];
        return [
          p.id,
          [...new Map(names.map((name) => [name.trim().toLowerCase(), name.trim()])).values()]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b)),
        ];
      }),
    );
    const attempts = new Map(this.attempts().map((a) => [a.id, a]));
    const suggestions =
      hidden || !discloseSuggestions
        ? []
        : [
            ...new Set(
              visible?.findings.flatMap((f) => f.suggestions.map((q) => q.problemId)) ?? [],
            ),
          ].flatMap((id) => {
            if (!maybe(this.db, 'SELECT 1 FROM problems WHERE id = ?', id)) return [];
            const p = discloseProblem(this.db, problemView(this.db, id));
            return [{ id: p.id, title: p.title }];
          });
    return {
      worker: hidden ? undefined : worker,
      enabled: this.enabled(),
      hidden,
      ...coverage,
      pending: jobs.filter((j) => j.status === 'pending' || j.status === 'running').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      embeddingStatus: this.embeddingStatus,
      error: hidden ? null : (this.error ?? jobs.find((j) => j.status === 'failed')?.error ?? null),
      report: hidden ? null : visible,
      stale,
      reportStatus,
      reportActivity: hidden ? null : this.reportActivity,
      observations: hidden
        ? []
        : active
            .filter((o) => referenced.has(o.id))
            .map((o) => ({
              ...o,
              problemTitle: attempts.get(o.attemptId)!.problem.title,
              studyDate: attempts.get(o.attemptId)!.studyDate,
              topics: problemTopics.get(o.problemId) ?? [],
            })),
      suggestions,
    };
  }
}
