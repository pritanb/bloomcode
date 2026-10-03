import { randomUUID } from 'node:crypto';
import { runAIWorker } from './ai-process.js';
import { runInsightWorker, type GenerateReport } from './insight-worker.js';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { runNextJob, type TutorJobs } from './jobs.js';
import type { Generate } from './generate.js';
import {
  defaultTutorSettings,
  TUTOR_EFFORTS,
  type TutorErrorKind,
  type TutorJobKind,
  type TutorProvider,
  type TutorRunnerStatus,
  type TutorSettings,
  type TutorTestResult,
} from '../../shared/tutor.js';
import { TutorError, cliVersion } from './cli.js';
import { findCodex } from './codex.js';
import { findClaude } from './claude.js';

const effort = z.enum(TUTOR_EFFORTS as [string, ...string[]]);
// The server executes this path, so accept only an absolute path to the named executable.
const cliPath = (name: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine(
      (p) => p.startsWith('/') && basename(p) === name,
      `Use the absolute path to the ${name} executable`,
    )
    .nullable();
const model = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9._:-]+$/);
export const tutorSettingsSchema = z
  .object({
    provider: z.enum(['codex', 'claude', 'off']),
    codexPath: cliPath('codex'),
    model,
    claudePath: cliPath('claude'),
    claudeModel: model,
    effort: z
      .object({ review: effort, extraction: effort, report: effort, topics: effort })
      .strict(),
  })
  .strict();
// Per-call ceilings stay below each job's claim lease.
const TIMEOUT_MS: Record<TutorJobKind, number> = {
  review: 180_000,
  extraction: 180_000,
  report: 240_000,
  topics: 120_000,
};
export const REPORT_BUDGET_MS = 540_000;
// Retrying these immediately would only fail every queued job the same way.
const PAUSE_MS: Partial<Record<TutorErrorKind, number>> = {
  usage_limit: 30 * 60_000,
  not_signed_in: 5 * 60_000,
  model_unavailable: 5 * 60_000,
  not_installed: 60_000,
};

// Machine-specific configuration (it names a local executable), so it lives
// beside the database rather than in the portable study export.
export class TutorSettingsFile {
  private cached: TutorSettings;
  constructor(private dir: string | null) {
    let saved: unknown = null;
    try {
      if (dir) saved = JSON.parse(readFileSync(join(dir, 'tutor-settings.json'), 'utf8'));
    } catch {
      /* defaults */
    }
    // The retired MCP sampling provider loads as off, keeping the CLI choices.
    if ((saved as { provider?: string })?.provider === 'mcp-sampling')
      saved = { ...(saved as object), provider: 'off' };
    const parsed = tutorSettingsSchema.safeParse({
      ...defaultTutorSettings,
      ...((saved as object) ?? {}),
      effort: { ...defaultTutorSettings.effort, ...((saved as { effort?: object })?.effort ?? {}) },
    });
    this.cached = parsed.success ? (parsed.data as TutorSettings) : defaultTutorSettings;
  }
  get(): TutorSettings {
    return this.cached;
  }
  save(next: TutorSettings) {
    const settings = tutorSettingsSchema.parse(next) as TutorSettings;
    if (this.dir) {
      const file = join(this.dir, 'tutor-settings.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    }
    this.cached = settings;
    return settings;
  }
}

// What differs between the providers; everything else in the worker is shared.
type CliProvider = Exclude<TutorProvider, 'off'>;
interface Provider {
  label: string;
  find(configured: string | null): Promise<string | null>;
  path(settings: TutorSettings): string | null;
  model(settings: TutorSettings): string;
  installHint: string;
}
export const PROVIDERS: Record<CliProvider, Provider> = {
  codex: {
    label: 'Codex',
    find: (configured) => findCodex(configured),
    path: (s) => s.codexPath,
    model: (s) => s.model,
    installHint: 'Install the ChatGPT app or the Codex CLI, or set its path in Settings.',
  },
  claude: {
    label: 'Claude Code',
    find: (configured) => findClaude(configured),
    path: (s) => s.claudePath,
    model: (s) => s.claudeModel,
    installHint: 'Install Claude Code, or set its path in Settings.',
  },
};
function notFound(provider: CliProvider, settings: TutorSettings) {
  const { label, path, installHint } = PROVIDERS[provider];
  const configured = path(settings);
  return new TutorError(
    'not_installed',
    configured
      ? `No executable ${label} at ${configured}.`
      : `${label} was not found. ${installHint}`,
  );
}

// Idle until woken: the app calls wake() after anything that can create work.
export class TutorWorker {
  private stopped = true;
  private running = false;
  private again = false;
  private resumeTimer: NodeJS.Timeout | undefined;
  private abort = new AbortController();
  private activeKind: TutorJobKind | null = null;
  private pausedUntil = 0;
  private lastError: TutorRunnerStatus['lastError'] = null;
  private lastSuccessAt: string | null = null;
  private cliPath: string | null = null;
  constructor(
    private settings: TutorSettingsFile,
    private jobs: TutorJobs,
    private clock: () => Date,
  ) {}
  start() {
    this.stopped = false;
    this.wake(); // work left queued before a restart
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.resumeTimer);
    this.abort.abort();
    this.abort = new AbortController();
  }
  /** Run queued jobs until none is left. A wake during a run triggers one more pass. */
  wake() {
    if (this.stopped) return;
    if (this.running) this.again = true;
    else void this.drain();
  }
  private async drain() {
    this.running = true;
    try {
      do {
        this.again = false;
        try {
          while (
            !this.stopped &&
            (await this.ready()) &&
            (await runNextJob(this.jobs, this.generate, REPORT_BUDGET_MS, this.report))
          );
        } catch {
          /* The job stays queued for the next wake. */
        }
      } while (this.again && !this.stopped);
    } finally {
      this.running = false;
    }
  }
  /** A provider is selected and not paused, so queued work will be written. */
  active() {
    return this.settings.get().provider !== 'off' && this.clock().getTime() >= this.pausedUntil;
  }
  /** Settings changed or a test succeeded: forget pauses so work resumes now. */
  reset() {
    this.pausedUntil = 0;
    this.lastError = null;
    this.cliPath = null;
  }
  /** Find the selected CLI, pausing work when it is missing. */
  private async locate(settings: TutorSettings, provider: CliProvider) {
    this.cliPath = await PROVIDERS[provider].find(PROVIDERS[provider].path(settings));
    if (this.cliPath) return this.cliPath;
    const error = notFound(provider, settings);
    this.fail(error);
    throw error;
  }
  private async ready() {
    const settings = this.settings.get();
    if (settings.provider === 'off' || this.clock().getTime() < this.pausedUntil) return false;
    // Check before claiming, so a missing install pauses work instead of failing queued jobs.
    try {
      await this.locate(settings, settings.provider);
      return true;
    } catch {
      return false;
    }
  }
  private fail(error: TutorError) {
    this.lastError = { kind: error.kind, message: error.message, at: this.clock().toISOString() };
    const pause = PAUSE_MS[error.kind];
    if (!pause) return;
    this.pausedUntil = this.clock().getTime() + pause;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.wake(), pause);
    this.resumeTimer.unref();
  }
  /** Run one worker call for the selected provider, recording the outcome. */
  private async run<T>(kind: TutorJobKind | null, call: (provider: CliProvider) => Promise<T>) {
    const settings = this.settings.get();
    if (settings.provider === 'off') throw new TutorError('crashed', 'The AI tutor is off.');
    const provider = settings.provider;
    await this.locate(settings, provider);
    this.activeKind = kind;
    try {
      const result = await call(provider);
      this.lastError = null;
      this.lastSuccessAt = this.clock().toISOString();
      return result;
    } catch (error) {
      if (error instanceof TutorError) this.fail(error);
      throw error;
    } finally {
      this.activeKind = null;
    }
  }
  private report: GenerateReport = (request) =>
    this.run('report', (provider) => {
      const settings = this.settings.get();
      return runInsightWorker(request, {
        provider,
        cliPath: this.cliPath,
        model: PROVIDERS[provider].model(settings),
        effort: settings.effort.report,
        signal: this.abort.signal,
        progress: (text) => {
          request.insights.reportActivity = text;
        },
      });
    });
  private generate: Generate = (request) =>
    this.run(request.kind === 'connection' ? null : request.kind, (provider) => {
      const settings = this.settings.get();
      return runAIWorker(
        {
          id: randomUUID(),
          kind: request.kind,
          context: request.context,
          timeoutMs:
            request.kind === 'connection'
              ? 90_000
              : Math.min(TIMEOUT_MS[request.kind], request.timeoutMs),
        },
        {
          provider,
          cliPath: this.cliPath,
          model: PROVIDERS[provider].model(settings),
          effort: request.kind === 'connection' ? 'low' : settings.effort[request.kind],
          signal: this.abort.signal,
        },
      );
    });
  status(): TutorRunnerStatus {
    const settings = this.settings.get();
    return {
      provider: settings.provider,
      cliPath:
        this.cliPath ??
        (settings.provider === 'off' ? null : PROVIDERS[settings.provider].path(settings)),
      activeKind: this.activeKind,
      pausedUntil:
        this.pausedUntil > this.clock().getTime() ? new Date(this.pausedUntil).toISOString() : null,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
  async test(settings: TutorSettings): Promise<TutorTestResult> {
    const started = Date.now();
    const failed = (path: string | null, version: string | null, error: TutorError) => ({
      ok: false,
      path,
      version,
      model: null,
      ms: path ? Date.now() - started : 0,
      error: { kind: error.kind, message: error.message },
    });
    if (settings.provider === 'off')
      return failed(null, null, new TutorError('crashed', 'Choose a tutor to test.'));
    const provider = PROVIDERS[settings.provider];
    const path = await provider.find(provider.path(settings));
    if (!path) return failed(null, null, notFound(settings.provider, settings));
    const version = await cliVersion(path);
    try {
      const result = await runAIWorker(
        { id: randomUUID(), kind: 'connection', context: {}, timeoutMs: 90_000 },
        {
          provider: settings.provider,
          cliPath: path,
          model: provider.model(settings),
          effort: 'low',
          signal: this.abort.signal,
        },
      );
      if (settings.provider === this.settings.get().provider) this.reset();
      return {
        ok: true,
        path,
        version,
        model: result.model,
        ms: Date.now() - started,
        error: null,
      };
    } catch (error) {
      return failed(
        path,
        version,
        error instanceof TutorError
          ? error
          : new TutorError('crashed', `${provider.label} test failed.`),
      );
    }
  }
}
