import type { FastifyInstance, FastifyRequest } from 'fastify';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { assertMetadataVisible } from '../catalogue/problem-model.js';
import { ApiError } from '../db/errors.js';
import { LocalEmbeddings, type Embed } from './embeddings.js';
import { TopicAnalysis } from '../topics/topic-analysis.js';
import { Insights } from './service.js';
import type { TutorControl } from '../tutor/routes.js';
/** The learning-insights and topic-analysis services, recovered after a restart. */
export function createInsights(
  app: FastifyInstance,
  s: Store,
  clock: () => Date,
  dbPath: string,
  embed?: Embed,
) {
  const local = new LocalEmbeddings(
    join(dbPath === ':memory:' ? tmpdir() : dirname(dbPath), 'embedding-models'),
  );
  const insights = new Insights(s, clock, embed ?? local.embed);
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
  const topics = new TopicAnalysis(s, clock);
  topics.recover();
  return { insights, topics };
}
export function registerInsights(
  app: FastifyInstance,
  s: Store,
  insights: Insights,
  topics: TopicAnalysis,
  verifyBearer: (header: string | undefined) => boolean,
  tutor: TutorControl,
) {
  const bearer = (req: FastifyRequest) => {
    if (!verifyBearer(req.headers.authorization))
      throw new ApiError(
        403,
        'BEARER_REQUIRED',
        'Only the local tutor adapter may search evidence',
      );
  };
  const status = () => ({
    ...insights.status(),
    tutorConnected: tutor.active(),
    runner: tutor.status(),
  });
  app.get('/api/insights', status);
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
  app.post('/api/insights/enable', (req) => {
    assertMetadataVisible(s);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    insights.put({ id: 'state', kind: 'state', enabled });
    insights.reconcile();
    return status();
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
}
