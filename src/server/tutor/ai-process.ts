import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { CodexError } from './codex.js';
import { tutorRuntimePaths } from './conversation.js';

export interface WorkerResult {
  text: string;
  model: string | null;
}
export interface WorkerOptions {
  model: string;
  effort: string;
  codexPath: string | null;
  signal: AbortSignal;
  progress?: (text: string | null) => void;
  entry?: string;
}
interface Handlers {
  check?: () => unknown;
  evidence?: (attemptId: string) => unknown;
  candidate?: (report: unknown) => string | undefined;
  completed?: () => void;
}
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
    text: z.string().max(100000).optional(),
    model: z.string().optional(),
  }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    type: z.literal('error'),
    kind: z.enum([
      'usage_limit',
      'not_signed_in',
      'model_unavailable',
      'crashed',
      'not_installed',
      'invalid_output',
    ]),
    message: z.string().max(1000),
  }),
]);

/** Shared transport only: Python owns AI policy; callers own authorisation and persistence. */
export function runAIWorker(
  request: { id: string; kind: string; context: unknown; timeoutMs: number },
  options: WorkerOptions,
  handlers: Handlers = {},
  runtime = tutorRuntimePaths(),
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new Error('AI task cancelled.'));
    const child = spawn(
      runtime.python,
      [join(dirname(runtime.worker), options.entry ?? 'ai_worker.py')],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    );
    let buffer = '',
      settled = false,
      candidates = 0,
      reads = 0,
      seq = 0;
    const id = request.id;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };
    const finish = (error?: Error, result?: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(accessTimer);
      options.signal.removeEventListener('abort', cancel);
      options.progress?.(null);
      if (error) {
        if (child.exitCode !== null || child.signalCode !== null) {
          reject(error);
          return;
        }
        child.stdin.write(JSON.stringify({ v: 1, id, type: 'cancel' }) + '\n', () => {});
        kill('SIGTERM');
        const hardKill = setTimeout(() => kill('SIGKILL'), 2000);
        child.once('close', () => clearTimeout(hardKill));
        hardKill.unref();
        reject(error);
      } else resolve(result!);
    };
    const check = () => handlers.check?.();
    const cancel = () => finish(new Error('AI task cancelled.'));
    const timer = setTimeout(
      () => finish(new CodexError('timeout', 'AI task timed out. Retry the task.')),
      request.timeoutMs,
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
        new CodexError(
          'not_installed',
          'Python AI runtime could not start. Install python/requirements.txt in python/.venv or set BLOOMCODE_PYTHON.',
        ),
      ),
    );
    child.stdin.on('error', () => finish(new Error('AI worker disconnected.')));
    // Keep only a recognised exception category, never traceback text or source records.
    let diagnosticBuffer = '',
      startupFailure: string | undefined;
    child.stderr.on('data', (chunk: Buffer) => {
      diagnosticBuffer = (diagnosticBuffer + chunk.toString()).slice(-4096);
      const category = diagnosticBuffer.match(
        /(?:^|\n)(ModuleNotFoundError|ImportError|SyntaxError|IndentationError|UnicodeDecodeError|JSONDecodeError|RuntimeError|ValueError|PermissionError|FileNotFoundError):/,
      )?.[1];
      if (category) startupFailure = category;
    });
    child.on('close', (code) => {
      if (!settled)
        finish(
          new CodexError(
            startupFailure === 'ModuleNotFoundError' || startupFailure === 'ImportError'
              ? 'not_installed'
              : 'crashed',
            `AI worker exited (${code ?? 'signal'}${startupFailure ? `; ${startupFailure}` : ''}). ` +
              (startupFailure === 'ModuleNotFoundError' || startupFailure === 'ImportError'
                ? 'Install python/requirements.txt using the interpreter configured by BLOOMCODE_PYTHON, or python/.venv/bin/python, then restart BloomCode.'
                : 'Restart BloomCode and retry. If this continues, check the configured Python runtime and worker installation.'),
          ),
        );
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString();
      if (buffer.length > 2_000_000)
        return finish(new Error('AI worker exceeded its message limit.'));
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
            if (++reads > 12 || !handlers.evidence) throw new Error('Unexpected evidence request.');
            send({
              type: 'evidence_result',
              seq: event.seq,
              attempt: handlers.evidence(event.attemptId),
            });
          } else if (event.type === 'candidate') {
            if (++candidates > 2 || !handlers.candidate)
              throw new Error('Unexpected report candidate.');
            send({
              type: 'candidate_result',
              seq: event.seq,
              error: handlers.candidate(event.report),
            });
          } else if (event.type === 'progress') options.progress?.(event.message);
          else if (event.type === 'error') throw new CodexError(event.kind, event.message);
          else {
            handlers.completed?.();
            finish(undefined, { text: event.text ?? '', model: event.model ?? options.model });
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
        kind: request.kind,
        model: options.model,
        effort: options.effort,
        codexPath: options.codexPath,
      }) + '\n',
    );
  });
}
