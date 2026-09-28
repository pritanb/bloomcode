import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/core/app.js';
import { insert, openDb } from '../../src/server/db/db.js';
import { LocalApi } from '../../src/integrations/local-api.js';
import { CodexError, findCodex, runCodex } from '../../src/server/tutor/codex.js';
import { defaultTutorSettings } from '../../src/shared/tutor.js';
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

// A stand-in for the Codex CLI: never the real one, which would spend plan usage.
const FAKE = `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);let stdin='';
process.stdin.on('data',c=>stdin+=c).on('end',()=>{
  if(process.env.FAKE_CODEX_LOG&&process.env.FAKE_CODEX_MODE!=='pipeline')fs.writeFileSync(process.env.FAKE_CODEX_LOG,JSON.stringify({args,stdin,cwd:process.cwd()}));
  const mode=process.env.FAKE_CODEX_MODE||'ok';
  if(mode==='hang')return setInterval(()=>{},1000);
  if(mode==='unauth'){console.log(JSON.stringify({type:'turn.failed',error:{message:'unexpected status 401 Unauthorized: Missing bearer'}}));process.exit(1);}
  if(mode==='usage'){console.log(JSON.stringify({type:'turn.failed',error:{message:"You've hit your usage limit. Try again later."}}));process.exit(1);}
  let reply=process.env.FAKE_CODEX_REPLY||'Summary:\\nFake review.';
  if(mode==='pipeline'){
    const data=stdin.slice(stdin.indexOf('<data>')+7,stdin.lastIndexOf('</data>'));
    const phase=stdin.includes('Select the three topics')?'topics':stdin.includes('ONE completed')?'extract':stdin.includes('learning report')?'report':'review';
    fs.appendFileSync(process.env.FAKE_CODEX_LOG,phase+'\\n');
    if(phase==='topics')reply=JSON.stringify({topics:[{topicNumber:1,reason:'Arrays is below the 4/5 target.'}]});
    if(phase==='extract')reply=JSON.stringify({observations:[{summary:'The learner reports forgetting an empty input.',polarity:'difficulty',evidenceType:'learner_reported',sourceField:'notes',excerpt:'Forgot empty input.'}],limitation:'Self-reported; no test execution.'});
    if(phase==='report')reply=JSON.stringify({findings:[{title:'Check boundary cases',kind:'single_problem',explanation:'This attempt reports forgetting an empty input.',action:'Check whether empty input is permitted before submitting.',evidenceIds:[JSON.parse(data).context.evidence[0].id],caveat:'One self-report is not a recurring pattern.',suggestions:[]}],limitation:'One attempt analyzed.'});
  }
  fs.writeFileSync(args[args.indexOf('-o')+1],reply);
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
});
`;
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
});
const run = (timeoutMs = 10_000) =>
  runCodex({
    path: fake,
    model: 'm',
    effort: 'high',
    prompt: '<data>secret notes</data>',
    timeoutMs,
  });

test('runs isolated, sends the prompt only on stdin and returns the final message', async () => {
  process.env.FAKE_CODEX_LOG = join(dir, 'log.json');
  expect(await run()).toEqual({ text: 'Summary:\nFake review.', model: 'm' });
  const log = JSON.parse(await readFile(process.env.FAKE_CODEX_LOG, 'utf8')) as {
    args: string[];
    stdin: string;
    cwd: string;
  };
  for (const flag of [
    '--ignore-user-config',
    '--ephemeral',
    'shell_tool',
    'read-only',
    'model_reasoning_effort="high"',
  ])
    expect(log.args).toContain(flag);
  expect(log.args.at(-1)).toBe('-');
  expect(log.stdin).toContain('secret notes');
  expect(log.args.join(' ')).not.toContain('secret notes');
  expect(log.cwd).toContain('lc-tutor-codex-');
});

test('classifies sign-in, usage-limit, timeout and missing-install failures', async () => {
  for (const [mode, kind] of [
    ['unauth', 'not_signed_in'],
    ['usage', 'usage_limit'],
  ] as const) {
    process.env.FAKE_CODEX_MODE = mode;
    await expect(run()).rejects.toMatchObject({ kind });
  }
  process.env.FAKE_CODEX_MODE = 'hang';
  await expect(run(300)).rejects.toMatchObject({ kind: 'timeout' });
  expect(await findCodex(null, [join(dir, 'missing')])).toBeNull();
  await expect(
    runCodex({
      path: join(dir, 'missing'),
      model: 'm',
      effort: 'low',
      prompt: 'x',
      timeoutMs: 1000,
    }),
  ).rejects.toBeInstanceOf(CodexError);
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
