import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../../src/server/core/app.js';
import type { Attempt } from '../../src/shared/contracts.js';
import { Insights } from '../../src/server/insights/service.js';
import { Store } from '../../src/server/db/store.js';
import { openDb } from '../../src/server/db/db.js';
import { addProblem } from '../../src/server/catalogue/catalogue.js';
import type { AttemptRecord } from '../../src/server/attempts/attempts.js';
import type { ObservationInput } from '../../src/shared/insights.js';
const embed = async (texts: string[]) =>
  texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)));
let app: Awaited<ReturnType<typeof createApp>>;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: 'Bearer test', 'idempotency-key': url },
    ...(payload ? { payload } : {}),
  });
beforeEach(async () => {
  app = await createApp({ dbPath: ':memory:', token: 'test', embed });
});
afterEach(async () => {
  await app.close();
});
async function completed(slug = 'example') {
  const p = (
    await call('POST', '/api/problems', {
      title: slug,
      url: `https://leetcode.com/problems/${slug}/`,
    })
  ).json();
  const a = (
    await call('POST', '/api/attempts', { problemId: p.id, context: 'targeted' })
  ).json<Attempt>();
  return (
    await call('POST', `/api/attempts/${a.id}/finish`, {
      version: a.version,
      outcome: 'solved',
      help: 'none',
      activeSeconds: 60,
      code: 'return nums[0]',
      notes: 'I forgot to check an empty input.',
    })
  ).json<Attempt>();
}
const observation: ObservationInput = {
  summary: 'Missed empty-input handling',
  polarity: 'difficulty',
  evidenceType: 'learner_reported',
  sourceField: 'notes',
  excerpt: 'I forgot to check an empty input.',
};
const claim = async () => (await call('POST', '/api/insights/claim', {})).json().work;
const complete = async (work: { job: { id: string; claimId: string } }, result: unknown) =>
  call('POST', '/api/insights/complete', {
    id: work.job.id,
    claimId: work.job.claimId,
    result,
    model: 'test-tutor',
  });
it('validates evidence, deduplicates completed jobs, rejects stale claims and preserves study records', async () => {
  const a = await completed();
  const before = (await call('GET', '/api/export')).json();
  await call('POST', '/api/insights/enable', { enabled: true });
  const work = await claim();
  expect(work.context.attemptId).toBe(a.id);
  expect(await claim()).toBeNull();
  expect(
    (
      await complete(work, {
        observations: [{ ...observation, excerpt: 'invented' }],
        limitation: '',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await complete(work, {
        observations: [{ ...observation, evidenceType: 'code_inferred' }],
        limitation: '',
      })
    ).statusCode,
  ).toBe(400);
  expect((await complete(work, { observations: [observation], limitation: '' })).statusCode).toBe(
    200,
  );
  expect((await complete(work, { observations: [observation], limitation: '' })).statusCode).toBe(
    200,
  );
  const exported = (await call('GET', '/api/export')).json();
  expect(
    exported.tables.learning_insights.filter((r: { kind: string }) => r.kind === 'observation'),
  ).toHaveLength(1);
  for (const table of [
    'attempts',
    'score_decisions',
    'review_targets',
    'daily_plans',
    'plan_items',
  ])
    expect(exported.tables[table]).toEqual(before.tables[table]);
  await call('PATCH', `/api/attempts/${a.id}/reflection`, {
    version: a.version,
    mistakeLabels: [],
    takeaway: 'Check bounds next time',
  });
  expect((await complete(work, { observations: [], limitation: '' })).statusCode).toBe(409);
  const next = await claim();
  expect(next.job.claimId).not.toBe(work.job.claimId);
  expect(next.context.takeaway).toBe('Check bounds next time');
});
it('persists corrections and job recovery through export/restore, accepts old snapshots', async () => {
  const a = await completed();
  await call('POST', '/api/insights/enable', { enabled: true });
  const work = await claim();
  await complete(work, { observations: [observation], limitation: '' });
  const first = (await call('GET', '/api/export')).json();
  const o = first.tables.learning_insights.find((r: { kind: string }) => r.kind === 'observation');
  expect(
    (
      await call('POST', `/api/insights/observations/${o.id}/dismiss`, {
        reason: 'This was a hypothetical reminder.',
      })
    ).statusCode,
  ).toBe(200);
  await call('PATCH', `/api/attempts/${a.id}/reflection`, {
    version: a.version,
    mistakeLabels: [],
    takeaway: 'Updated context',
  });
  const pending = await claim();
  expect(pending.context.corrections).toHaveLength(1);
  const snapshot = (await call('GET', '/api/export')).json();
  expect(snapshot.schemaVersion).toBe(4);
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', embed });
  expect((await call('POST', '/api/restore', { confirmEmpty: true, snapshot })).statusCode).toBe(
    200,
  );
  const recovered = await claim();
  expect(recovered.job.claimId).not.toBe(pending.job.claimId);
  expect(recovered.context.corrections[0].reason).toContain('hypothetical');
  await complete(recovered, { observations: [observation], limitation: '' });
  expect(
    (await call('GET', '/api/export'))
      .json()
      .tables.learning_insights.filter((r: { kind: string }) => r.kind === 'observation'),
  ).toHaveLength(1);
  const legacy = structuredClone(first);
  legacy.schemaVersion = 3;
  delete legacy.tables.learning_insights;
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', embed });
  expect(
    (await call('POST', '/api/restore', { confirmEmpty: true, snapshot: legacy })).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/insights')).json().enabled).toBe(false);
});
it('protects mixed assessment data and requires bearer authentication for processing', async () => {
  await completed();
  await call('POST', '/api/insights/enable', { enabled: true });
  const work = await claim();
  const p = (
    await call('POST', '/api/problems', {
      title: 'fresh',
      url: 'https://leetcode.com/problems/fresh/',
    })
  ).json();
  await call('POST', '/api/attempts', { problemId: p.id, context: 'mixed' });
  expect((await call('GET', '/api/insights')).json()).toMatchObject({
    hidden: true,
    report: null,
    observations: [],
    suggestions: [],
  });
  for (const path of ['claim', 'retrieve'])
    expect(
      (await call('POST', `/api/insights/${path}`, path === 'retrieve' ? { query: 'empty' } : {}))
        .statusCode,
    ).toBe(403);
  expect((await complete(work, { observations: [], limitation: '' })).statusCode).toBe(403);
  const session = await app.inject({ method: 'GET', url: '/api/session' });
  const response = await app.inject({
    method: 'POST',
    url: '/api/insights/claim',
    headers: {
      cookie: session.headers['set-cookie'] as string,
      'x-csrf-token': session.json().csrfToken,
    },
    payload: {},
  });
  expect(response.statusCode).toBe(403);
  const spoof = await app.inject({
    method: 'POST',
    url: '/api/insights/claim',
    headers: {
      authorization: 'Bearer invalid',
      cookie: session.headers['set-cookie'] as string,
      'x-csrf-token': session.json().csrfToken,
    },
    payload: {},
  });
  expect(spoof.json().error.code).toBe('BEARER_REQUIRED');
});
it('recovers expired claims and retries failures without dropping pending attempts', async () => {
  let now = Date.now();
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', embed, clock: () => new Date(now) });
  await completed();
  await call('POST', '/api/insights/enable', { enabled: true });
  const first = await claim();
  now += 241000;
  const next = await claim();
  expect(next.job.claimId).not.toBe(first.job.claimId);
  expect((await complete(first, { observations: [], limitation: '' })).statusCode).toBe(409);
  await call('POST', '/api/insights/fail', {
    id: next.job.id,
    claimId: next.job.claimId,
    error: 'Disconnected',
  });
  expect((await call('GET', '/api/insights')).json().failed).toBe(1);
  await call('POST', '/api/insights/retry', {});
  expect((await claim()).job.status).toBe('running');
});
it('validates cross-problem recurrence, citations and suggestions; dismissal removes stale findings', async () => {
  const db = openDb(':memory:'),
    s = new Store(db.sqlite),
    clock = () => new Date('2026-09-24T00:00:00Z');
  const service = new Insights(s, clock, embed);
  try {
    for (const id of ['one', 'two']) {
      const p = addProblem(s, {
        title: id,
        url: `https://leetcode.com/problems/${id}/`,
        leetcodeTopics: ['Array', 'array'],
      });
      s.put('tags', {
        id: 'topic-tag',
        name: 'Binary Search',
        description: '',
        kind: 'topic',
        archived: false,
      });
      s.put('tags', { id: 'legacy-topic', name: 'Stack', description: '', archived: false });
      s.put('problem_tags', {
        id: `${id}-legacy`,
        problemId: p.id,
        tagId: 'legacy-topic',
        difficulty: null,
      });
      s.put('tags', {
        id: 'pattern-tag',
        name: 'Hidden pattern',
        description: '',
        kind: 'pattern',
        archived: false,
      });
      s.put('problem_tags', {
        id: `${id}-topic`,
        problemId: p.id,
        tagId: 'topic-tag',
        difficulty: null,
      });
      s.put('problem_tags', {
        id: `${id}-pattern`,
        problemId: p.id,
        tagId: 'pattern-tag',
        difficulty: null,
      });
      s.put('attempts', {
        id,
        problemId: p.id,
        problem: p,
        status: 'completed',
        code: '',
        notes: observation.excerpt,
        language: 'python',
        takeaway: '',
        mistakeLabels: [],
        outcome: 'solved',
        help: 'none',
        confidence: 3,
        evidence: 'retention',
        studyDate: '2026-09-20',
        finishedAt: '2026-09-20T00:00:00Z',
        feedback: null,
        activeSeconds: 60,
      } as unknown as AttemptRecord);
    }
    service.put({ id: 'state', kind: 'state', enabled: true });
    for (let i = 0; i < 2; i++) {
      const work = service.claim()!;
      service.complete(
        work.job.id,
        work.job.claimId!,
        { observations: [observation], limitation: '' },
        'test',
      );
    }
    await service.tick();
    const report = service.claim()!;
    expect(report.job.attemptId).toBeNull();
    expect(service.status().reportStatus).toBe('generating');
    const ids = service.observations().map((o) => o.id);
    const finding = {
      title: 'Check empty inputs',
      kind: 'recurring',
      explanation: 'Two attempts report missed empty inputs.',
      action: 'Trace the empty input before submission.',
      evidenceIds: ids,
      caveat: 'Self-reported evidence only.',
      suggestions: [],
    };
    expect(() =>
      service.complete(
        report.job.id,
        report.job.claimId!,
        { findings: [{ ...finding, evidenceIds: [ids[0]] }], limitation: '' },
        'test',
      ),
    ).toThrow('two different');
    expect(() =>
      service.complete(
        report.job.id,
        report.job.claimId!,
        { findings: [{ ...finding, evidenceIds: ['fake'] }], limitation: '' },
        'test',
      ),
    ).toThrow('cite');
    expect(() =>
      service.complete(
        report.job.id,
        report.job.claimId!,
        {
          findings: [{ ...finding, suggestions: [{ problemId: 'fake', reason: 'invented' }] }],
          limitation: '',
        },
        'test',
      ),
    ).toThrow('catalogue');
    expect(() =>
      service.complete(
        report.job.id,
        report.job.claimId!,
        { findings: [{ ...finding, action: Array(26).fill('word').join(' ') }], limitation: '' },
        'test',
      ),
    ).toThrow('at most 25 words');
    expect(service.status().report).toBeNull();
    service.complete(
      report.job.id,
      report.job.claimId!,
      { findings: [finding], limitation: 'Retrieved examples are not a prevalence estimate.' },
      'test',
    );
    expect(() =>
      service.complete(report.job.id, 'stale-claim', { findings: [], limitation: '' }, 'test'),
    ).toThrow();
    expect(service.status().reportStatus).toBe('ready');
    expect(service.status().report?.findings).toHaveLength(1);
    expect(
      service
        .status()
        .observations.every(
          (o) =>
            o.topics.length === 3 &&
            o.topics.includes('Stack') &&
            o.topics.includes('Binary Search') &&
            o.topics.some((t) => t.toLowerCase() === 'array'),
        ),
    ).toBe(true);
    service.dismiss(ids[0], 'Misinterpreted note');
    expect(service.status().report?.findings).toHaveLength(0);
  } finally {
    service.stop();
    db.sqlite.close();
  }
});

it('rolls back restore when a correction points at unrelated evidence', async () => {
  await completed();
  await call('POST', '/api/insights/enable', { enabled: true });
  const work = await claim();
  await complete(work, { observations: [observation], limitation: '' });
  const snapshot = (await call('GET', '/api/export')).json();
  const o = snapshot.tables.learning_insights.find(
    (r: { kind: string }) => r.kind === 'observation',
  );
  await call('POST', `/api/insights/observations/${o.id}/dismiss`, { reason: 'Incorrect reading' });
  const invalid = (await call('GET', '/api/export')).json();
  invalid.tables.learning_insights.find(
    (r: { kind: string }) => r.kind === 'correction',
  ).observationId = 'state';
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', embed });
  expect(
    (await call('POST', '/api/restore', { confirmEmpty: true, snapshot: invalid })).statusCode,
  ).toBe(400);
  expect((await call('GET', '/api/export')).json().tables.attempts).toEqual([]);
});
it('reports a failed model download without affecting saved attempts and supports retry', async () => {
  await app.close();
  let fail = true;
  app = await createApp({
    dbPath: ':memory:',
    token: 'test',
    embed: async (texts) => {
      if (fail) throw Error('Download unavailable');
      return embed(texts);
    },
  });
  const a = await completed();
  await call('POST', '/api/insights/enable', { enabled: true });
  expect((await call('GET', '/api/insights')).json()).toMatchObject({
    embeddingStatus: 'failed',
    error: 'Download unavailable',
  });
  expect((await call('GET', `/api/attempts/${a.id}`)).json().code).toBe('return nums[0]');
  fail = false;
  await call('POST', '/api/insights/retry', {});
  expect((await call('GET', '/api/insights')).json().embeddingStatus).toBe('ready');
});

it('serves topic analysis as a static route rather than looking up an analysis topic', async () => {
  const response = await call('GET', '/api/topics/analysis');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ topics: [], report: null, enabled: false });
});

it('tracks MCP heartbeats independently of analysis and rejects browser heartbeat spoofing', async () => {
  let now = Date.now();
  await app.close();
  app = await createApp({ dbPath: ':memory:', token: 'test', embed, clock: () => new Date(now) });
  const heartbeat = {
    id: 'f0bf9ea5-6274-4ff9-834c-6819398209cc',
    sampling: true,
    automaticReviews: true,
  };
  expect((await call('GET', '/api/mcp/status')).json().state).toBe('unknown');
  expect((await call('POST', '/api/mcp/heartbeat', heartbeat)).statusCode).toBe(200);
  now += 31_000;
  expect((await call('GET', '/api/mcp/status')).json().state).toBe('connected');
  now += 15_000;
  expect((await call('GET', '/api/mcp/status')).json().state).toBe('disconnected');
  await call('POST', '/api/mcp/heartbeat', heartbeat);
  expect((await call('GET', '/api/topics/analysis')).json().connection).toMatchObject({
    state: 'connected',
    sampling: true,
  });
  const session = await app.inject({ method: 'GET', url: '/api/session' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/mcp/heartbeat',
        headers: {
          cookie: session.headers['set-cookie'] as string,
          'x-csrf-token': session.json().csrfToken,
        },
        payload: heartbeat,
      })
    ).statusCode,
  ).toBe(403);
});
