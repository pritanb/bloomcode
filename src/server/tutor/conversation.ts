import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { type Db, maybe } from '../db/db.js';
import { ApiError, conflict } from '../db/errors.js';
import { repoRoot } from '../paths.js';
import type { ChatState } from '../../shared/tutor-chat.js';
import { PROVIDERS, TutorSettingsFile } from './worker.js';

const result = z.object({
  conversationId: z.string(),
  coaching: z
    .object({
      id: z.string(),
      attemptId: z.string(),
      status: z.enum(['active', 'paused', 'completed']),
      needsRetry: z.boolean(),
    })
    .nullable()
    .optional(),
  coachingError: z.string().nullable().optional(),
  activity: z.string().default(''),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(100),
  proposals: z.array(
    z.object({
      kind: z.enum(['goal', 'preferences', 'plan', 'note']),
      key: z.string(),
      change: z.record(z.string(), z.unknown()),
    }),
  ),
});
const empty = (): ChatState => ({
  status: 'closed',
  messages: [],
  proposals: [],
  activity: '',
  draft: '',
  error: null,
});

export class TutorConversation {
  state = empty();
  private child?: ChildProcessWithoutNullStreams;
  private retiring?: ChildProcessWithoutNullStreams;
  private reopen = false;
  private timer?: NodeJS.Timeout;
  private current?: string;
  private requests = new Map<string, string>();
  constructor(
    private command: string,
    private args: string[],
    private timeout = 180_000,
  ) {}

  /** The launch arguments without the provider options. */
  baseArgs() {
    const index = this.args.indexOf('--provider');
    return index < 0 ? this.args : this.args.slice(0, index);
  }

  start() {
    if (this.child) return;
    this.state = { ...empty(), status: 'starting', activity: 'Opening your conversation…' };
    if (
      this.retiring?.pid &&
      this.retiring.exitCode === null &&
      this.retiring.signalCode === null
    ) {
      this.reopen = true;
      return;
    }
    this.reopen = false;
    const child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (child !== this.child) return;
      buffer += chunk;
      if (buffer.length > 4_000_000)
        return this.fail('Tutor output exceeded its limit. Start a new conversation.');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line);
          if (event.v !== 1) throw Error('protocol');
          if (event.type === 'fatal') return this.fail(String(event.message));
          if (event.type !== 'ready' && event.id !== this.current) continue;
          if (event.type === 'ready' || event.type === 'result') {
            this.state = { ...empty(), ...result.parse(event), status: 'ready' };
            clearTimeout(this.timer);
            this.current = undefined;
          } else if (event.type === 'activity') this.state.activity = String(event.message);
          else if (event.type === 'delta') this.state.draft += String(event.text);
          else if (event.type === 'error') {
            clearTimeout(this.timer);
            this.current = undefined;
            this.state = {
              ...this.state,
              ...(result.safeParse(event).success ? result.parse(event) : {}),
              status: 'ready',
              draft: '',
              activity: '',
              error: String(event.message),
            };
          }
        } catch {
          this.fail('The tutor worker returned an invalid response. Reopen the tutor to retry.');
        }
      }
    });
    // Do not forward raw SDK stderr, credentials or study records to the browser.
    child.stdin.on('error', () => {
      if (child === this.child) this.fail('The tutor connection closed. Reopen it to continue.');
    });
    child.stderr.resume();
    child.once('error', () => {
      if (child === this.child)
        this.fail(
          'Python could not start. Install python/requirements.txt in python/.venv, or set BLOOMCODE_PYTHON.',
        );
    });
    child.once('exit', () => {
      if (child === this.child)
        this.fail(
          'The tutor stopped unexpectedly. Reopen it to resume the last completed conversation.',
        );
    });
    this.deadline();
  }
  private deadline() {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        this.fail(
          'The tutor timed out. Your completed conversation is saved; reopen it to continue.',
        ),
      this.timeout,
    );
    this.timer.unref();
  }
  private fail(message: string) {
    this.stop();
    this.state.status = 'error';
    this.state.error = message;
  }
  /** Use new launch arguments (another provider or model), restarting only if they changed. */
  configure(args: string[]) {
    if (JSON.stringify(args) === JSON.stringify(this.args)) return;
    this.args = args;
    if (this.child) this.stop();
  }

  stop() {
    this.reopen = false;
    clearTimeout(this.timer);
    const child = this.child;
    this.child = undefined;
    this.current = undefined;
    if (child) {
      this.retiring = child;
      child.once('exit', () => {
        if (this.retiring === child) this.retiring = undefined;
        if (this.reopen) this.start();
      });
      child.kill('SIGTERM');
      const kill = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }, 1500);
      kill.unref();
    }
    this.state = { ...this.state, status: 'closed', draft: '', activity: '', proposals: [] };
  }
  send(id: string, body: Record<string, unknown>) {
    const fingerprint = JSON.stringify(body);
    if (this.requests.has(id)) {
      if (this.requests.get(id) !== fingerprint)
        throw conflict('Request ID was reused with different input');
      return;
    }
    if (!this.child || this.state.status !== 'ready')
      throw conflict('Open the tutor and wait for the current request to finish');
    this.requests.set(id, fingerprint);
    if (this.requests.size > 100) this.requests.delete(this.requests.keys().next().value!);
    this.current = id;
    this.state = {
      ...this.state,
      status: 'working',
      activity: 'Thinking…',
      draft: '',
      error: null,
    };
    if (body.method === 'reply')
      this.state.messages = [
        ...this.state.messages,
        { role: 'user' as const, text: String(body.message) },
      ].slice(-100);
    this.child.stdin.write(JSON.stringify({ v: 1, id, ...body }) + '\n');
    this.deadline();
  }
}

export function tutorRuntimePaths(
  defaultRoot = fileURLToPath(repoRoot),
  env: NodeJS.ProcessEnv = process.env,
) {
  const root = env.BLOOMCODE_TUTOR_ROOT || defaultRoot;
  return {
    python:
      env.BLOOMCODE_PYTHON ??
      join(
        root,
        'python',
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    worker: join(root, 'python/worker.py'),
  };
}

/** worker.py arguments for the saved tutor provider. Codex stays the default, as before. */
export async function chatProviderArgs(settingsDir: string | null): Promise<string[]> {
  const settings = new TutorSettingsFile(settingsDir).get();
  if (settings.provider !== 'claude') return [];
  const path = await PROVIDERS.claude.find(settings.claudePath);
  return [
    '--provider',
    'claude',
    '--model',
    settings.claudeModel,
    ...(path ? ['--cli-path', path] : []),
  ];
}

export function registerConversation(
  app: FastifyInstance,
  db: Db,
  dbPath: string,
  worker?: TutorConversation,
) {
  let chat = worker;
  const blocked = () => !!maybe(db, "SELECT id FROM attempts WHERE status != 'completed'");
  const guard = () => {
    if (blocked()) {
      chat?.stop();
      throw new ApiError(
        403,
        'TUTOR_PRACTICE',
        'Finish or cancel active practice before using the tutor.',
      );
    }
  };
  app.addHook('onResponse', async (req) => {
    if (req.method !== 'GET' && blocked()) chat?.stop();
  });
  app.addHook('onClose', async () => {
    chat?.stop();
  });
  app.get('/api/tutor-access', () => ({ allowed: !blocked() }));
  app.get('/api/tutor-chat', () => {
    if (blocked()) {
      chat?.stop();
      return { ...empty(), status: 'blocked' };
    }
    const state = chat?.state ?? empty();
    const ids = [
      ...new Set(
        state.messages.flatMap(
          (m) => m.text.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi) ?? [],
        ),
      ),
    ].slice(0, 40);
    const evidence = ids.flatMap((id) => {
      const record = maybe<{ id: string; title: string }>(
        db,
        "SELECT a.id, p.title FROM attempts a JOIN problems p ON p.id = a.problemId WHERE a.id = ? AND a.status = 'completed'",
        id,
      );
      return record ? [record] : [];
    });
    return { ...state, evidence };
  });
  app.post('/api/tutor-chat/open', async () => {
    guard();
    // An injected worker (tests) keeps its own arguments.
    const provider = worker
      ? []
      : await chatProviderArgs(dbPath === ':memory:' ? null : dirname(dbPath));
    if (!chat) {
      const runtime = tutorRuntimePaths();
      if (!existsSync(runtime.python) || !existsSync(runtime.worker))
        throw new ApiError(
          503,
          'TUTOR_RUNTIME',
          'Python tutor runtime was not found. Follow python/README.md. For desktop development, restart npm run electron:dev from the worktree.',
        );
      const address = app.server.address();
      if (!address || typeof address === 'string')
        throw new ApiError(503, 'TUTOR_SERVER', 'The local server is not listening');
      chat = new TutorConversation(runtime.python, [
        runtime.worker,
        '--api-url',
        `http://127.0.0.1:${address.port}`,
        '--token-file',
        join(dirname(dbPath), 'api-token'),
        ...provider,
      ]);
    } else if (!worker) chat.configure([...chat.baseArgs(), ...provider]);
    chat.start();
    return chat.state;
  });
  app.post('/api/tutor-chat/message', (req) => {
    guard();
    const body = z
      .object({
        id: z.string().uuid(),
        message: z.string().trim().min(1).max(12000),
        attemptId: z.string().uuid().optional(),
        coach: z.string().trim().min(1).max(300).optional(),
      })
      .strict()
      .parse(req.body);
    if (!chat) throw conflict('Open the tutor first');
    if (
      body.attemptId &&
      !maybe(db, "SELECT id FROM attempts WHERE id = ? AND status = 'completed'", body.attemptId)
    )
      throw new ApiError(400, 'TUTOR_CONTEXT', 'Choose a completed attempt');
    chat.send(body.id, {
      method: 'reply',
      message: body.message,
      ...(body.attemptId ? { attemptId: body.attemptId } : {}),
      ...(body.coach ? { coach: body.coach } : {}),
    });
    return { accepted: true };
  });
  app.post('/api/tutor-chat/confirm', (req) => {
    guard();
    const body = z
      .object({
        id: z.string().uuid(),
        key: z.string().uuid(),
        kind: z.enum(['goal', 'preferences', 'plan', 'note']),
        approved: z.boolean(),
      })
      .strict()
      .parse(req.body);
    if (!chat?.state.proposals.some((p) => p.key === body.key && p.kind === body.kind))
      throw conflict('This proposal is no longer pending');
    chat.send(body.id, {
      method: 'confirm',
      key: body.key,
      kind: body.kind,
      approved: body.approved,
    });
    return { accepted: true };
  });
  app.post('/api/tutor-chat/coaching', (req) => {
    guard();
    const body = z
      .object({ id: z.string().uuid(), action: z.enum(['pause', 'resume', 'retry']) })
      .strict()
      .parse(req.body);
    if (!chat) throw conflict('Open the tutor first');
    chat.send(body.id, { method: 'coaching', action: body.action });
    return { accepted: true };
  });
  app.post('/api/tutor-chat/new', () => {
    guard();
    if (!chat) throw conflict('Open the tutor first');
    chat.send(randomUUID(), { method: 'new' });
    return { accepted: true };
  });
  app.post('/api/tutor-chat/cancel', () => {
    chat?.stop();
    return { cancelled: true };
  });
}
