import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '../db/store.js';
import type { AttemptRecord } from '../attempts/attempt-model.js';
import { newestAttempt } from '../attempts/attempt-model.js';
import type { Problem, Tag } from '../../shared/contracts.js';
import {
  ANALYSIS_VERSION,
  REPORT_VERSION,
  REPORT_WRITING_RULES,
  EMBEDDING_MODEL,
  EMBEDDING_REVISION,
  extractionResult,
  conciseReportResult,
  type InsightJob,
  type InsightReport,
  type LearningRecord,
  type Observation,
  type InsightStatus,
} from '../../shared/insights.js';
import {
  assertMetadataVisible,
  discloseProblem,
  type TagLink,
} from '../catalogue/problem-model.js';
import { conflict, ApiError } from '../db/errors.js';
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
const freshJob = (id: string, attemptId: string | null, fingerprint: string): InsightJob => ({
  id,
  kind: 'job',
  attemptId,
  fingerprint,
  status: 'pending',
  claimId: null,
  claimedAt: 0,
  error: null,
  model: null,
  durationMs: 0,
  limitation: '',
  evidenceIds: [],
  questionIds: [],
});
export class Insights {
  embeddingStatus: InsightStatus['embeddingStatus'] = 'idle';
  error: string | null = null;
  tutorActive = () => false;
  /** A learning report can only be claimed once local search is ready. */
  onEmbeddingsReady = () => {};
  private busy = false;
  private stopped = false;
  private refreshing: Promise<void> | undefined;
  private again = false;
  constructor(
    readonly s: Store,
    readonly clock: () => Date,
    readonly embed: Embed,
  ) {}
  records() {
    return this.s.all<LearningRecord>('learning_insights');
  }
  put<T extends LearningRecord>(record: T): T {
    return this.s.put('learning_insights', record);
  }
  enabled() {
    return this.records().some((r) => r.kind === 'state' && r.enabled);
  }
  attempts() {
    return this.s
      .all<AttemptRecord>('attempts')
      .filter((a) => a.status === 'completed')
      .sort(newestAttempt);
  }
  jobs() {
    return this.records().filter((r): r is InsightJob => r.kind === 'job');
  }
  corrections() {
    return this.records().filter((r) => r.kind === 'correction');
  }
  observations() {
    const versions = new Map(this.attempts().map((a) => [a.id, fingerprint(a)]));
    const corrections = this.corrections();
    return this.records().filter(
      (r): r is Observation =>
        r.kind === 'observation' &&
        versions.get(r.attemptId) === r.fingerprint &&
        !corrections.some(
          (c) =>
            c.attemptId === r.attemptId &&
            c.sourceField === r.sourceField &&
            c.excerpt === r.excerpt,
        ),
    );
  }
  reconcile() {
    if (!this.enabled()) return;
    const jobs = new Map(this.jobs().map((j) => [j.id, j]));
    for (const a of this.attempts()) {
      const id = `attempt-${a.id}`,
        fp = fingerprint(a),
        old = jobs.get(id);
      if (!old || old.fingerprint !== fp) this.put(freshJob(id, a.id, fp));
    }
  }
  coverage() {
    const attempts = this.attempts(),
      jobs = this.jobs();
    return {
      total: attempts.length,
      analyzed: attempts.filter((a) =>
        jobs.some(
          (j) => j.attemptId === a.id && j.status === 'done' && j.fingerprint === fingerprint(a),
        ),
      ).length,
    };
  }
  catalogue() {
    const tags = new Map(
      this.s
        .all<Tag & { patternNotes?: string; recognitionCues?: string; pitfalls?: string }>('tags')
        .filter((t) => !t.archived)
        .map((t) => [t.id, t]),
    );
    const links = this.s.all<TagLink>('problem_tags');
    return this.s.all<Problem>('problems').map((p) => ({
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      topics: p.leetcodeTopics ?? [],
      patterns: links
        .filter((l) => l.problemId === p.id)
        .flatMap((l) => {
          const t = tags.get(l.tagId);
          return t
            ? [
                {
                  name: t.name,
                  description: t.description,
                  notes: (t.patternNotes ?? '').slice(0, 1200),
                  recognitionCues: (t.recognitionCues ?? '').slice(0, 600),
                  pitfalls: (t.pitfalls ?? '').slice(0, 600),
                },
              ]
            : [];
        }),
    }));
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
    return (
      this.records()
        .filter((r): r is InsightReport => r.kind === 'report')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ??
      null
    );
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
      const missing = rows
        .filter(
          (r) =>
            !this.s.sql
              .prepare('SELECT id FROM insight_embeddings WHERE id=? AND fingerprint=? AND model=?')
              .get(r.id, r.fingerprint, modelKey),
        )
        .slice(0, 16);
      if (wasReady && !missing.length) return false;
      this.embeddingStatus = 'loading';
      // An empty warm-up downloads/loads the model even before tutor observations exist.
      const vectors = await this.embed(missing.map((r) => r.summary));
      if (this.stopped) return false;
      if (
        vectors.length !== missing.length ||
        vectors.some((v) => v.length !== 384 || v.some((n) => !Number.isFinite(n)))
      )
        throw Error('Embedding model returned invalid vectors');
      this.s.transaction(() =>
        missing.forEach((r, i) =>
          this.s.sql
            .prepare(
              'INSERT OR REPLACE INTO insight_embeddings (id,fingerprint,model,vector) VALUES (?,?,?,?)',
            )
            .run(r.id, r.fingerprint, modelKey, JSON.stringify(vectors[i])),
        ),
      );
      this.embeddingStatus = 'ready';
      this.error = null;
      this.onEmbeddingsReady();
      return missing.length > 0;
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
      (
        this.s.sql
          .prepare('SELECT id,vector FROM insight_embeddings WHERE model=?')
          .all(modelKey) as { id: string; vector: string }[]
      ).map((r) => [r.id, JSON.parse(r.vector) as number[]]),
    );
  }
  async retrieval(query: string, limit = 12) {
    assertMetadataVisible(this.s);
    const rows = this.observations(),
      vectors = this.vectors();
    const [vector] = await this.embed([query]);
    assertMetadataVisible(this.s);
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
      writingRules: REPORT_WRITING_RULES,
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
      limitations: this.jobs()
        .filter((j) => j.status === 'done' && j.limitation)
        .slice(0, 20)
        .map((j) => ({ attemptId: j.attemptId, limitation: j.limitation })),
    };
  }
  claim() {
    assertMetadataVisible(this.s);
    if (!this.enabled()) return null;
    this.reconcile();
    const reportJob = this.jobs().find((j) => j.id === 'report-job');
    if (reportJob?.status === 'running' && reportJob.fingerprint !== this.corpusFingerprint())
      this.put(freshJob('report-job', null, this.corpusFingerprint()));
    const now = this.clock().getTime(),
      jobs = this.jobs();
    if (jobs.some((j) => j.status === 'running' && now - j.claimedAt < leaseMs(j))) return null;
    const attempts = this.attempts(),
      pending = jobs
        .filter((j) => j.attemptId && (j.status === 'pending' || j.status === 'running'))
        .sort(
          (a, b) =>
            attempts.findIndex((x) => x.id === a.attemptId) -
            attempts.findIndex((x) => x.id === b.attemptId),
        );
    const coverage = this.coverage(),
      report = this.latestReport(),
      fp = this.corpusFingerprint();
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
    if (shouldReport && !(oldReportJob?.fingerprint === fp && oldReportJob.status === 'failed'))
      job = oldReportJob?.fingerprint === fp ? oldReportJob : freshJob('report-job', null, fp);
    else job = pending[0];
    if (!job) return null;
    const context = job.attemptId ? this.extractionContext(job.attemptId) : this.reportContext();
    const reportContext = context as ReturnType<Insights['reportContext']>;
    job = this.put({
      ...job,
      status: 'running',
      claimId: randomUUID(),
      claimedAt: now,
      error: null,
      ...(!job.attemptId
        ? {
            evidenceIds: reportContext.evidence.map((o) => o.id),
            questionIds: reportContext.questions.map((q) => q.id),
          }
        : {}),
    });
    return { job, context };
  }
  extractionContext(attemptId: string) {
    const a = this.s.get<AttemptRecord>('attempts', attemptId);
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
      corrections: this.corrections().filter((c) => c.attemptId === a.id),
    };
  }
  currentJob(id: string, claimId: string) {
    assertMetadataVisible(this.s);
    const job = this.s.get<InsightJob>('learning_insights', id);
    if (job.kind !== 'job' || job.claimId !== claimId || !this.enabled())
      throw conflict('This analysis claim is no longer current');
    const fp = job.attemptId
      ? fingerprint(this.s.get<AttemptRecord>('attempts', job.attemptId))
      : this.corpusFingerprint();
    if (job.fingerprint !== fp) throw conflict('Evidence changed; request a new analysis');
    if (!['running', 'done'].includes(job.status)) throw conflict('Analysis is not running');
    return job;
  }
  complete(id: string, claimId: string, result: unknown, model: string | null) {
    return this.s.transaction(() => {
      const job = this.currentJob(id, claimId);
      if (job.status === 'done') return { ok: true };
      if (job.attemptId) {
        const data = extractionResult.parse(result),
          a = this.s.get<AttemptRecord>('attempts', job.attemptId),
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
          const correction = this.corrections().some(
            (c) =>
              c.attemptId === a.id && c.sourceField === o.sourceField && c.excerpt === o.excerpt,
          );
          if (!correction)
            this.put({
              id: hash([a.id, job.fingerprint, o]),
              kind: 'observation',
              ...o,
              attemptId: a.id,
              problemId: a.problemId,
              fingerprint: job.fingerprint,
              createdAt: this.clock().toISOString(),
              analysisVersion: ANALYSIS_VERSION,
              model,
            });
        }
        job.limitation =
          (context.truncated ? 'Source was truncated to the analysis context limit. ' : '') +
          data.limitation;
        job.limitation = job.limitation.slice(0, 1000);
      } else {
        const data = conciseReportResult.parse(result),
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
        this.put({
          id: randomUUID(),
          kind: 'report',
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
      this.put({
        ...job,
        status: 'done',
        model,
        durationMs: Math.max(0, this.clock().getTime() - job.claimedAt),
      });
      return { ok: true };
    });
  }
  dismiss(id: string, reason: string) {
    assertMetadataVisible(this.s);
    const o = this.observations().find((o) => o.id === id);
    if (!o) throw conflict('Observation is already dismissed or outdated');
    this.put({
      id: `correction-${id}`,
      kind: 'correction',
      observationId: id,
      attemptId: o.attemptId,
      summary: o.summary,
      sourceField: o.sourceField,
      excerpt: o.excerpt,
      reason,
      createdAt: this.clock().toISOString(),
    });
  }
  status(discloseSuggestions = true): InsightStatus {
    const hidden = this.s
      .all<AttemptRecord>('attempts')
      .some((a) => a.context === 'mixed' && a.status !== 'completed');
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
    const topicTags = new Map(
      this.s
        .all<Tag>('tags')
        .filter((t) => (t.kind === 'topic' || t.kind === undefined) && !t.archived)
        .map((t) => [t.id, t.name]),
    );
    const topicLinks = this.s.all<TagLink>('problem_tags');
    const problemTopics = new Map(
      this.s.all<Problem>('problems').map((p) => {
        const names = [
          ...(p.leetcodeTopics ?? []),
          ...topicLinks
            .filter((l) => l.problemId === p.id)
            .flatMap((l) => (topicTags.has(l.tagId) ? [topicTags.get(l.tagId)!] : [])),
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
            const p = this.s.all<Problem>('problems').find((p) => p.id === id);
            if (!p) return [];
            discloseProblem(this.s, p, this.clock);
            return [{ id: p.id, title: p.title }];
          });
    return {
      worker: hidden ? undefined : worker,
      enabled: this.enabled(),
      hidden,
      ...coverage,
      pending: jobs.filter((j) => j.status === 'pending' || j.status === 'running').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      tutorConnected: this.tutorActive(),
      embeddingStatus: this.embeddingStatus,
      error: hidden ? null : (this.error ?? jobs.find((j) => j.status === 'failed')?.error ?? null),
      report: hidden ? null : visible,
      stale,
      reportStatus,
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
