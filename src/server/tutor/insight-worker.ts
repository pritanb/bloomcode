import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Insights } from '../insights/service.js';
import type { InsightJob } from '../../shared/insights.js';
import { CodexError } from './codex.js';
import { ApiError } from '../db/errors.js';
import { tutorRuntimePaths } from './conversation.js';
import { dirname, join } from 'node:path';

export interface ReportRequest {
  insights: Insights;
  job: InsightJob;
  context: ReturnType<Insights['reportContext']>;
  budgetMs: number;
}
export type GenerateReport = (request: ReportRequest) => Promise<void>;
const message = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('evidence'),
    seq: z.number().int(),
    attemptId: z.string(),
  }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('candidate'),
    seq: z.number().int(),
    report: z.unknown(),
  }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('progress'),
    message: z.string().max(200),
  }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('result'),
    trace: z.array(z.unknown()).max(2),
  }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('error'),
    kind: z.enum(['usage_limit', 'not_signed_in', 'model_unavailable', 'crashed']),
    message: z.string().max(1000),
  }),
]);

/** Python owns generation; this bridge owns access checks, persistence and process lifetime. */
export function runInsightWorker(
  request: ReportRequest,
  options: {
    model: string;
    effort: string;
    codexPath: string | null;
    signal: AbortSignal;
    progress?: (text: string | null) => void;
  },
  runtime = tutorRuntimePaths(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new Error('Report cancelled.'));
    const child = spawn(runtime.python, [join(dirname(runtime.worker), 'insights_worker.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let buffer = '',
      settled = false,
      saved = false,
      candidates = 0,
      reads = 0,
      seq = 0;
    const id = request.job.claimId!;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(accessTimer);
      options.signal.removeEventListener('abort', cancel);
      options.progress?.(null);
      if (error) {
        child.stdin.write(JSON.stringify({ v: 1, id, type: 'cancel' }) + '\n', () => {});
        kill('SIGTERM');
        const hardKill = setTimeout(() => kill('SIGKILL'), 2000);
        child.once('close', () => clearTimeout(hardKill));
        hardKill.unref();
        reject(error);
      } else resolve();
    };
    const check = () => request.insights.currentJob(request.job.id, id);
    const cancel = () => finish(new Error('Report cancelled.'));
    const timer = setTimeout(
      () => finish(new Error('Learning report timed out. Retry the report.')),
      request.budgetMs,
    );
    const accessTimer = setInterval(() => {
      try {
        check();
      } catch {
        finish(new Error('Report access or evidence changed. Retry after practice ends.'));
      }
    }, 500);
    options.signal.addEventListener('abort', cancel, { once: true });
    child.on('error', () =>
      finish(
        new Error(
          'Python AI runtime could not start. Install python/requirements.txt in python/.venv or set BLOOMCODE_PYTHON.',
        ),
      ),
    );
    child.stdin.on('error', () => finish(new Error('Learning report worker disconnected.')));
    // Consume diagnostics without logging potentially private SDK data.
    child.stderr.resume();
    child.on('close', (code) => {
      if (!settled)
        finish(
          new Error(
            `Learning report worker exited (${code ?? 'signal'}). Check Python dependencies and file-based Codex sign-in.`,
          ),
        );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();
      if (buffer.length > 2_000_000)
        return finish(new Error('Report worker exceeded its message limit.'));
      while (buffer.includes('\n') && !settled) {
        const end = buffer.indexOf('\n'),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const event = message.parse(JSON.parse(line));
          if (event.id !== id) throw new Error('Mismatched report request.');
          check();
          if ('seq' in event && event.seq !== ++seq) throw new Error('Mismatched report sequence.');
          const send = (data: object) =>
            child.stdin.write(JSON.stringify({ v: 1, id, ...data }) + '\n');
          if (event.type === 'evidence') {
            if (++reads > 8) throw new Error('Report evidence request limit exceeded.');
            const attempt = request.insights.reportAttempt(request.job.id, id, event.attemptId);
            send({ type: 'evidence_result', seq: event.seq, attempt });
          } else if (event.type === 'candidate') {
            if (saved || ++candidates > 2) throw new Error('Report correction limit exceeded.');
            try {
              request.insights.complete(request.job.id, id, event.report, options.model);
              saved = true;
              send({ type: 'candidate_result', seq: event.seq });
            } catch (error) {
              if (
                error instanceof z.ZodError ||
                (error instanceof ApiError && ['VALIDATION', 'EVIDENCE'].includes(error.code))
              ) {
                send({
                  type: 'candidate_result',
                  seq: event.seq,
                  error: error.message.slice(0, 2000),
                });
              } else throw error;
            }
          } else if (event.type === 'progress') options.progress?.(event.message);
          else if (event.type === 'error') throw new CodexError(event.kind, event.message);
          else {
            if (!saved) throw new Error('Report worker completed without a validated report.');
            finish();
            child.stdin.end();
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Invalid report worker message.'));
        }
      }
    });
    child.stdin.write(
      JSON.stringify({
        v: 1,
        type: 'start',
        id,
        context: request.context,
        model: options.model,
        effort: options.effort,
        codexPath: options.codexPath,
      }) + '\n',
    );
  });
}
