import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { insert, openDb } from '../../src/server/db/db.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { findCodex } from '../../src/server/tutor/codex.js';
import { TutorSettingsFile } from '../../src/server/tutor/worker.js';
import { defaultTutorSettings, type TutorTestResult } from '../../src/shared/tutor.js';
import type { Attempt, AutoReviewStatus } from '../../src/shared/contracts.js';

// The report transport is exercised separately without spending model usage.
vi.mock('../../src/server/tutor/insight-worker.js', () => ({
  runInsightWorker: async (
    request: import('../../src/server/tutor/insight-worker.js').ReportRequest,
    options: { model: string },
  ) => {
    const { appendFile } = await import('node:fs/promises');
    if (process.env.FAKE_CODEX_LOG) await appendFile(process.env.FAKE_CODEX_LOG, 'report\n');
    request.insights.complete(
      request.job.id,
      request.job.claimId!,
      {
        findings: [
          {
            title: 'Check empty input',
            kind: 'single_problem',
            explanation: 'A reflection reports a missed empty input.',
            action: 'Trace the empty input.',
            exercise: 'Trace your solution on an empty array.',
            successCheck: 'Explain which guard prevents indexing.',
            evidenceIds: [request.context.evidence[0].id],
            caveat: 'One self-report.',
            suggestions: [],
          },
        ],
        limitation: 'One attempt analyzed.',
      },
      options.model,
    );
  },
}));

vi.mock('../../src/server/tutor/ai-process.js', () => ({
  runAIWorker: async (
    request: { kind: string },
    options: { model: string; provider: string; cliPath: string | null; effort: string },
  ) => {
    const { appendFile, writeFile } = await import('node:fs/promises');
    const kind = request.kind;
    if (process.env.FAKE_OPTIONS_LOG)
      await writeFile(process.env.FAKE_OPTIONS_LOG, JSON.stringify({ kind, ...options }));
    if (process.env.FAKE_CODEX_MODE === 'pipeline' && process.env.FAKE_CODEX_LOG)
      await appendFile(
        process.env.FAKE_CODEX_LOG,
        (kind === 'extraction' ? 'extract' : kind) + '\n',
      );
    const output =
      kind === 'topics'
        ? { topics: [{ topicNumber: 1, reason: 'Arrays is below the 4/5 target.' }] }
        : {
            observations: [
              {
                summary: 'The learner reports forgetting an empty input.',
                polarity: 'difficulty',
                evidenceType: 'learner_reported',
                sourceField: 'notes',
                excerpt: 'Forgot empty input.',
              },
            ],
            limitation: 'Self-reported.',
          };
    return {
      model: options.model,
      text: kind === 'review' ? 'Summary:\nFake review.' : JSON.stringify(output),
    };
  },
}));

// A stand-in for the Codex CLI: never the real one, which would spend plan usage.
const FAKE = '#!/usr/bin/env node\nconsole.log("fake codex");\n';
let dir: string, fake: string;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lc-codex-'));
  fake = join(dir, 'codex');
  await writeFile(fake, FAKE);
  await chmod(fake, 0o755);
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return async () => {
    while (cleanups.length) await cleanups.pop()!();
  };
});
afterEach(() => {
  delete process.env.FAKE_CODEX_MODE;
  delete process.env.FAKE_CODEX_LOG;
  delete process.env.FAKE_OPTIONS_LOG;
});
test('detects a missing configured executable without invoking a model', async () => {
  expect(await findCodex(null, [join(dir, 'missing')])).toBeNull();
});

test('with Claude Code selected, the worker receives the Claude CLI and model', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lc-claude-app-'));
  const claude = join(dir, 'claude');
  await writeFile(claude, FAKE);
  await chmod(claude, 0o755);
  const settings = {
    ...defaultTutorSettings,
    provider: 'claude',
    claudePath: claude,
    claudeModel: 'opus',
  };
  await writeFile(join(data, 'tutor-settings.json'), JSON.stringify(settings));
  const app = await createApp({ dbPath: join(data, 'leetcode.sqlite') });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => {
    await app.close();
    await rm(data, { recursive: true, force: true });
  });
  process.env.FAKE_OPTIONS_LOG = join(data, 'options.json');
  const api = new LocalApi({ dataDir: data, baseUrl: url });
  const result = (await api.request('POST', '/api/tutor/test', settings)) as TutorTestResult;
  expect(result).toMatchObject({ ok: true, path: claude, model: 'opus' });
  expect(JSON.parse(await readFile(process.env.FAKE_OPTIONS_LOG, 'utf8'))).toMatchObject({
    kind: 'connection',
    provider: 'claude',
    cliPath: claude,
    model: 'opus',
    effort: 'low',
  });
});

test('settings saved before Claude Code existed load with its defaults', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lc-tutor-settings-'));
  cleanups.push(() => rm(data, { recursive: true, force: true }));
  const { claudePath: _path, claudeModel: _model, ...old } = defaultTutorSettings;
  await writeFile(
    join(data, 'tutor-settings.json'),
    JSON.stringify({ ...old, provider: 'codex', model: 'gpt-x' }),
  );
  expect(new TutorSettingsFile(data).get()).toMatchObject({
    provider: 'codex',
    model: 'gpt-x',
    claudePath: null,
    claudeModel: defaultTutorSettings.claudeModel,
  });
});

test('with Codex selected, the app writes queued reviews itself', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lc-codex-app-'));
  await writeFile(
    join(data, 'tutor-settings.json'),
    JSON.stringify({ ...defaultTutorSettings, provider: 'codex', codexPath: fake }),
  );
  const app = await createApp({ dbPath: join(data, 'leetcode.sqlite') });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => {
    await app.close();
    await rm(data, { recursive: true, force: true });
  });
  const api = new LocalApi({ dataDir: data, baseUrl: url });
  const p = (await api.request('POST', '/api/problems', {
    title: 'Two Sum',
    url: 'https://leetcode.com/problems/two-sum/',
  })) as { id: string };
  const a = (await api.request('POST', '/api/attempts', {
    problemId: p.id,
    context: 'targeted',
  })) as Attempt;
  await api.request(
    'POST',
    `/api/attempts/${a.id}/finish`,
    {
      version: a.version,
      outcome: 'solved',
      help: 'none',
      activeSeconds: 60,
      code: 'def f(): ...',
      notes: '',
      requestReview: true,
    },
    `finish-${a.id}`,
  );
  let status: AutoReviewStatus | undefined;
  for (let i = 0; i < 100 && status?.status !== 'done'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = (await api.request('GET', `/api/attempts/${a.id}/auto-review`)) as AutoReviewStatus;
  }
  expect(status?.status).toBe('done');
  expect(((await api.request('GET', `/api/attempts/${a.id}`)) as Attempt).feedback).toBe(
    'Summary:\nFake review.',
  );
});

test('the Codex worker writes the immediate review before the learning report and topic picks', async () => {
  process.env.FAKE_CODEX_MODE = 'pipeline';
  process.env.FAKE_CODEX_LOG = join(dir, 'phases.log');
  const data = await mkdtemp(join(tmpdir(), 'lc-codex-pipeline-'));
  await writeFile(
    join(data, 'tutor-settings.json'),
    JSON.stringify({ ...defaultTutorSettings, provider: 'codex', codexPath: fake }),
  );
  const dbPath = join(data, 'leetcode.sqlite');
  const seed = openDb(dbPath);
  insert(seed, 'topics', {
    id: 'arrays',
    name: 'Arrays',
    score: 2,
    version: 1,
    notes: '',
    lastReviewed: null,
    provisional: true,
  });
  seed.close();
  const app = await createApp({
    dbPath,
    embed: async (texts) =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
  });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(async () => {
    await app.close();
    await rm(data, { recursive: true, force: true });
  });
  const api = new LocalApi({ dataDir: data, baseUrl: url });
  const p = (await api.request('POST', '/api/problems', {
    title: 'Boundary',
    url: 'https://leetcode.com/problems/boundary/',
  })) as { id: string };
  const a = (await api.request('POST', '/api/attempts', {
    problemId: p.id,
    context: 'targeted',
  })) as Attempt;
  await api.request(
    'POST',
    `/api/attempts/${a.id}/finish`,
    {
      version: a.version,
      outcome: 'solved',
      help: 'none',
      activeSeconds: 60,
      code: 'return []',
      notes: 'Forgot empty input.',
      requestReview: true,
    },
    `finish-${a.id}`,
  );
  await api.request('POST', '/api/insights/enable', { enabled: true });
  await api.request('POST', '/api/topics/analysis/enable', { enabled: true });
  let report: unknown;
  let topics: { report: unknown } | undefined;
  for (let i = 0; i < 200 && !(report && topics?.report); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    report = ((await api.request('GET', '/api/insights')) as { report: unknown }).report;
    topics = (await api.request('GET', '/api/topics/analysis')) as { report: unknown };
  }
  expect(report).toMatchObject({
    model: defaultTutorSettings.model,
    analyzed: 1,
    findings: [{ kind: 'single_problem' }],
  });
  expect(topics?.report).toMatchObject({
    topicIds: ['arrays'],
    reasons: ['Arrays is below the 4/5 target.'],
  });
  expect(((await api.request('GET', `/api/attempts/${a.id}`)) as Attempt).feedback).toBe(
    'Summary:\nFake review.',
  );
  const phases = (await readFile(process.env.FAKE_CODEX_LOG, 'utf8')).trim().split('\n');
  expect(phases[0]).toBe('review');
  expect(phases.indexOf('extract')).toBeLessThan(phases.indexOf('report'));
  expect(phases).toContain('topics');
}, 30000);
