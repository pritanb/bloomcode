import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { startTutorLoop } from '../../integrations/auto-review.js';
import type { Api, Generate } from '../../integrations/generate.js';
import {
  defaultTutorSettings,
  TUTOR_EFFORTS,
  type CodexErrorKind,
  type TutorJobKind,
  type TutorRunnerStatus,
  type TutorSettings,
  type TutorTestResult,
} from '../../shared/tutor.js';
import { CodexError, codexPrompt, codexVersion, findCodex, runCodex } from './codex.js';

const effort = z.enum(TUTOR_EFFORTS as [string, ...string[]]);
export const tutorSettingsSchema = z
  .object({
    provider: z.enum(['codex', 'off']),
    // The server executes this path, so accept only an absolute path to a `codex` executable.
    codexPath: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine(
        (p) => p.startsWith('/') && basename(p) === 'codex',
        'Use the absolute path to the codex executable',
      )
      .nullable(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._:-]+$/),
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
export const CODEX_REPORT_BUDGET_MS = 540_000;
// Retrying these immediately would only fail every queued job the same way.
const PAUSE_MS: Partial<Record<CodexErrorKind, number>> = {
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
    // The retired MCP sampling provider loads as off, keeping the Codex choices.
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

export class CodexWorker {
  private stopLoop: (() => void) | undefined;
  private abort = new AbortController();
  private activeKind: TutorJobKind | null = null;
  private pausedUntil = 0;
  private lastError: TutorRunnerStatus['lastError'] = null;
  private lastSuccessAt: string | null = null;
  private codexPath: string | null = null;
  constructor(
    private settings: TutorSettingsFile,
    private api: Api,
    private clock: () => Date,
  ) {}
  start() {
    this.stopLoop ??= startTutorLoop(this.api, this.generate, {
      reportBudgetMs: CODEX_REPORT_BUDGET_MS,
      ready: () => this.ready(),
    });
  }
  stop() {
    this.stopLoop?.();
    this.stopLoop = undefined;
    this.abort.abort();
    this.abort = new AbortController();
  }
  /** Settings changed or a test succeeded: forget pauses so work resumes now. */
  reset() {
    this.pausedUntil = 0;
    this.lastError = null;
    this.codexPath = null;
  }
  private async ready() {
    const settings = this.settings.get();
    if (settings.provider !== 'codex' || this.clock().getTime() < this.pausedUntil) return false;
    // Check before claiming, so a missing install pauses work instead of failing queued jobs.
    this.codexPath = await findCodex(settings.codexPath);
    if (!this.codexPath)
      this.fail(
        new CodexError(
          'not_installed',
          settings.codexPath
            ? `No executable Codex at ${settings.codexPath}.`
            : 'Codex was not found. Install the ChatGPT app or the Codex CLI, or set its path in Settings.',
        ),
      );
    return !!this.codexPath;
  }
  private fail(error: CodexError) {
    this.lastError = { kind: error.kind, message: error.message, at: this.clock().toISOString() };
    const pause = PAUSE_MS[error.kind];
    if (pause) this.pausedUntil = this.clock().getTime() + pause;
  }
  private generate: Generate = async (request) => {
    const settings = this.settings.get();
    this.codexPath = await findCodex(settings.codexPath);
    if (!this.codexPath) {
      const error = new CodexError(
        'not_installed',
        settings.codexPath
          ? `No executable Codex at ${settings.codexPath}.`
          : 'Codex was not found. Install the ChatGPT app or the Codex CLI, or set its path in Settings.',
      );
      this.fail(error);
      throw error;
    }
    this.activeKind = request.kind;
    try {
      const result = await runCodex({
        path: this.codexPath,
        model: settings.model,
        effort: settings.effort[request.kind],
        prompt: codexPrompt(request.system, request.user),
        timeoutMs: Math.min(TIMEOUT_MS[request.kind], request.timeoutMs),
        signal: this.abort.signal,
      });
      this.lastError = null;
      this.lastSuccessAt = this.clock().toISOString();
      return result;
    } catch (error) {
      if (error instanceof CodexError) this.fail(error);
      throw error;
    } finally {
      this.activeKind = null;
    }
  };
  status(): TutorRunnerStatus {
    const settings = this.settings.get();
    return {
      provider: settings.provider,
      codexPath: this.codexPath ?? settings.codexPath,
      activeKind: this.activeKind,
      pausedUntil:
        this.pausedUntil > this.clock().getTime() ? new Date(this.pausedUntil).toISOString() : null,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
    };
  }
  async test(settings: TutorSettings): Promise<TutorTestResult> {
    const started = Date.now();
    const path = await findCodex(settings.codexPath);
    if (!path)
      return {
        ok: false,
        path: null,
        version: null,
        model: null,
        ms: 0,
        error: {
          kind: 'not_installed',
          message:
            'Codex was not found. Install the ChatGPT app or the Codex CLI, or set its path.',
        },
      };
    const version = await codexVersion(path);
    try {
      const result = await runCodex({
        path,
        model: settings.model,
        effort: 'low',
        prompt: codexPrompt('Reply with exactly the word: ready', 'connection test'),
        timeoutMs: 90_000,
        signal: this.abort.signal,
      });
      if (settings.provider === 'codex') this.reset();
      return {
        ok: true,
        path,
        version,
        model: result.model,
        ms: Date.now() - started,
        error: null,
      };
    } catch (error) {
      const e =
        error instanceof CodexError ? error : new CodexError('crashed', 'Codex test failed.');
      return {
        ok: false,
        path,
        version,
        model: null,
        ms: Date.now() - started,
        error: { kind: e.kind, message: e.message },
      };
    }
  }
}
