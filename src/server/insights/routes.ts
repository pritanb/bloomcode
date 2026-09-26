import type { FastifyInstance, FastifyRequest } from 'fastify';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { ApiError } from '../db/errors.js';
import { LocalEmbeddings, type Embed } from './embeddings.js';
import { extractionResult, conciseReportResult } from '../../shared/insights.js';
import { TopicAnalysis } from '../topics/topic-analysis.js';
import { Insights } from './service.js';
import type { TutorControl } from '../tutor/routes.js';
const claim = z.object({ id: z.string().min(1).max(200), claimId: z.string().min(1).max(200) });
export function registerInsights(
  app: FastifyInstance,
  s: Store,
  clock: () => Date,
  dbPath: string,
  verifyBearer: (header: string | undefined) => boolean,
  tutor: TutorControl,
  embed?: Embed,
) {
  const bearer = (req: FastifyRequest) => {
    if (!verifyBearer(req.headers.authorization))
      throw new ApiError(
        403,
        'BEARER_REQUIRED',
        'Only the authenticated tutor adapter may process analysis',
      );
  };
  const local = new LocalEmbeddings(
    join(dbPath === ':memory:' ? tmpdir() : dirname(dbPath), 'embedding-models'),
  );
  const insights = new Insights(s, clock, embed ?? local.embed);
  insights.tutorActive = tutor.active;
  insights.onEmbeddingsReady = tutor.wake;
  // Recover interrupted leases without touching saved study records.
  for (const job of insights.jobs())
    if (job.status === 'running')
      insights.put({ ...job, status: 'pending', claimId: null, claimedAt: 0 });
  void insights.refresh();
  // Writes (including the tutor's saved analysis) can add attempts or observations to process.
  app.addHook('onResponse', async (req, reply) => {
    if (!['GET', 'HEAD'].includes(req.method) && reply.statusCode < 400) void insights.refresh();
  });
  app.addHook('onClose', async () => {
    insights.stop();
    await local.close();
  });
  app.get('/api/insights', () => ({
    ...insights.status(),
    runner: tutor.status(),
  }));
  const topics = new TopicAnalysis(s, clock);
  topics.recover();
  app.get('/api/topics/analysis', () => ({
    ...topics.status(),
    runner: tutor.status(),
  }));
  app.post('/api/topics/analysis/enable', (req) =>
    topics.enable(z.object({ enabled: z.boolean() }).strict().parse(req.body).enabled),
  );
  app.post('/api/topics/analysis/retry', (req) => {
    z.object({}).strict().parse(req.body);
    return topics.retry();
  });
  app.post('/api/topics/analysis/claim', (req) => {
    bearer(req);
    return { work: topics.claim() };
  });
  app.post('/api/topics/analysis/complete', (req) => {
    bearer(req);
    const b = z
      .object({ claimId: z.string(), topicIds: z.unknown(), reasons: z.unknown().optional() })
      .strict()
      .parse(req.body);
    return topics.complete(b.claimId, b.topicIds, b.reasons);
  });
  app.post('/api/topics/analysis/fail', (req) => {
    bearer(req);
    const b = z
      .object({ claimId: z.string(), error: z.string().max(1000) })
      .strict()
      .parse(req.body);
    return topics.fail(b.claimId, b.error);
  });
  app.post('/api/insights/enable', (req) => {
    assertMetadataVisible(s);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    insights.put({ id: 'state', kind: 'state', enabled });
    insights.reconcile();
    return insights.status();
  });
  app.post('/api/insights/retry', (req) => {
    assertMetadataVisible(s);
    z.object({}).strict().parse(req.body);
    for (const job of insights.jobs())
      if (job.status === 'failed')
        insights.put({ ...job, status: 'pending', claimId: null, error: null });
    insights.embeddingStatus = 'idle';
    insights.error = null;
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/insights/observations/:id/dismiss', (req) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    insights.dismiss(req.params.id, reason);
    return { ok: true };
  });
  app.post('/api/insights/claim', (req) => {
    bearer(req);
    const work = insights.claim();
    return {
      work: work
        ? {
            ...work,
            resultSchema: z.toJSONSchema(
              work.job.attemptId ? extractionResult : conciseReportResult,
            ),
          }
        : null,
    };
  });
  app.post('/api/insights/retrieve', async (req) => {
    bearer(req);
    const { query, limit } = z
      .object({
        query: z.string().trim().min(1).max(800),
        limit: z.number().int().min(1).max(20).default(12),
      })
      .strict()
      .parse(req.body);
    return { observations: await insights.retrieval(query, limit) };
  });
  app.post('/api/insights/complete', (req) => {
    bearer(req);
    const b = claim
      .extend({ result: z.unknown(), model: z.string().max(300).nullable().default(null) })
      .strict()
      .parse(req.body);
    return insights.complete(b.id, b.claimId, b.result, b.model);
  });
  app.post('/api/insights/fail', (req) => {
    bearer(req);
    const b = claim
      .extend({ error: z.string().max(1000) })
      .strict()
      .parse(req.body);
    const job = insights.currentJob(b.id, b.claimId);
    if (job.status !== 'done')
      insights.put({
        ...job,
        status: 'failed',
        error: b.error,
        durationMs: Math.max(0, clock().getTime() - job.claimedAt),
      });
    return { ok: true };
  });
}
