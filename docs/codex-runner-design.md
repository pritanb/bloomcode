# Design: Codex CLI tutor runner (draft)

Status: implemented on 2026-09-25. The `mcp-sampling` provider was removed on 2026-09-26: Codex and Off are the only providers, new workspaces start Off, and a saved `mcp-sampling` setting loads as Off. Differences from the draft:

- Settings live in `tutor-settings.json` beside the database, not in the settings table. The export/restore schema validates settings strictly.
- The worker polls every 3 s through in-process `app.inject` calls and does not wake on enqueue.
- `--output-schema` is not used. The existing prompts and validators, plus the single correction retry, cover structured output.
- Tools are disabled with `--disable` feature flags, and Codex's base instructions are replaced with `model_instructions_file`. Measured overhead is about 8.4k input tokens per call.
- The ChatGPT.app bundled CLI is preferred. The standalone 0.147 CLI rejected `gpt-6-luna` for ChatGPT accounts.
- A real run on disposable data produced a tutor report in about 20 s, extraction plus an xhigh learning report in about 32 s, and topic picks.

## Problem

Every AI feature (post-attempt tutor reports, Learning Insights, “Where to focus”) runs through MCP sampling: the adapter that Hermes launches polls the app, then asks Hermes to run the model. In practice this means:

- AI work only happens while Hermes is open, and a rebuild does not take effect until Hermes restarts. A version mismatch left topic analysis unreadable on 2026-09-25.
- The app is bound by limits it cannot see: Hermes’ 150 s timeout, a 4,096 max-token cap (reports request 8,000) and 10 requests/minute.
- Sampling is deprecated as of MCP `2026-07-28` (SEP-2577) and will eventually be removed.

Hermes already routes sampling to `openai-codex / gpt-6-luna` (`auxiliary.mcp` in `~/.hermes/config.yaml`), so it adds no quality benefit. The same ChatGPT subscription is available directly through `codex exec`.

## Goals

- Run tutor jobs whenever the app is running, with no dependency on an MCP client.
- Use the existing ChatGPT subscription through the signed-in Codex CLI. No API key and no per-request billing.
- Keep job queues, validation, scoring rules, study data and restore formats unchanged.
- Treat Codex as an untrusted text generator. It can only return JSON or text that the existing validators accept.

## Non-goals

- Removing the MCP adapter. Its tools (`get_today`, `save_review`, etc.) remain the way to chat with study data.
- Removing sampling now. It stays available as a provider until Hermes drops it.
- Local models, API keys, or changes to prompts or report contracts.

## Overview

```
Before:  app queue ⇄ adapter (spawned by Hermes) → sampling → Hermes → gpt-6-luna
After:   app queue ⇄ tutor worker (inside the app server) → codex exec → gpt-6-luna
```

A new **tutor provider** setting chooses who processes jobs:

| Provider                                                            | Who claims jobs              | Model call                        |
| ------------------------------------------------------------------- | ---------------------------- | --------------------------------- |
| `codex`                                                             | Worker inside the app server | `codex exec` child process        |
| `mcp-sampling` (current behaviour, default for existing workspaces) | MCP adapter                  | `server.createMessage` via Hermes |
| `off`                                                               | Nobody; jobs stay queued     | —                                 |

Claim endpoints only hand work to the active provider. The adapter receives `null` when the provider is `codex`, and vice versa. Existing claim leases still prevent double processing during a switch.

## Components

### 1. `Generate` interface (refactor, no behaviour change)

The three processors currently call the model in two different ways: `reviewNext` takes a `Sample`, while `analyzeNext` and `analyzeTopicsNext` call `server.createMessage` directly. Unify them:

```ts
type GenerateRequest = {
  kind: 'review' | 'extraction' | 'report' | 'topics';
  system: string;
  user: string;
  schema?: object; // JSON Schema for structured jobs
  maxTokens: number;
  timeoutMs: number;
};
type Generate = (req: GenerateRequest) => Promise<{ text: string; model: string | null }>;
```

- `samplingGenerate(server)` wraps the current `createMessage` calls.
- The processors take `Generate` plus `LocalApi`, so prompts, validation, the report correction retry and fail paths are shared by both providers.

### 2. `codexGenerate` (new, `src/server/tutor/codex.ts`)

Each job spawns one process:

```
codex exec
  --ignore-user-config        # no MCP servers (incl. leetcode-tutor itself), no user model defaults
  --ignore-rules
  --ephemeral                 # no session files containing saved code
  --skip-git-repo-check
  -s read-only
  -c approval_policy="never"
  -C <fresh empty temp dir>
  -m <model>  -c model_reasoning_effort=<effort>
  --output-schema <tmp>/schema.json   # structured jobs only
  -o <tmp>/last-message.txt
  --json                      # parse events for model name, usage, errors
  -                           # prompt on stdin, never argv (size, and hidden from ps)
```

- The prompt is the system prompt and the user payload, each clearly delimited. The payload is marked as data.
- **Timeout**: SIGTERM the process group at `timeoutMs`, then SIGKILL after 5 s. The temp directory is always removed.
- Results are read from `last-message.txt`. The model name and error class come from the `--json` events.
- **Error classes**, each mapped to a status message:
  - `not_installed`
  - `not_signed_in` (tell the user to run `codex login`)
  - `usage_limit` (pause until the reported reset time, or 30 min)
  - `timeout`
  - `invalid_output`
  - `crashed`

### 3. Tutor worker (new, `src/server/tutor/worker.ts`)

- Starts with the server when the provider is `codex`, and stops or restarts when the setting changes.
- Processes one job at a time, in the current priority order: attempt review, then insight job, then topic analysis.
- Wakes when a job is enqueued, with a 30 s poll as a fallback. There is no 3 s HTTP polling.
- Uses `LocalApi` against its own server with the existing bearer token, so it goes through exactly the same claim, complete and fail endpoints and validation as the adapter.
- After `usage_limit`, pauses all jobs until the reset time. It shows the reason in the UI and does not burn retries.

### 4. Timeouts and leases

The four-minute claim lease is too short for maximum-effort reports (up to 145 s through Hermes today, with no correction round). The lease becomes a per-kind value, and the runner timeout must be shorter than the lease:

| Kind                 | Default effort | Runner timeout | Lease |
| -------------------- | -------------- | -------------- | ----- |
| review               | high           | 180 s          | 240 s |
| extraction           | high           | 180 s          | 240 s |
| report (2 calls max) | xhigh          | 2 × 240 s      | 600 s |
| topics               | high           | 120 s          | 240 s |

`gpt-6-luna` supports `low`, `medium`, `high`, `xhigh` and `max`. Hermes currently runs every job at `max`. Each default is adjustable in Settings.

### 5. Settings and status

- **Settings → Tutor model**: provider (Codex / Hermes / Off).
- For Codex: executable path (auto-detected), model (default `gpt-6-luna`) and effort per job kind (defaults above).
- **Test** runs a trivial structured prompt and reports latency, the model name, or the error class.
- **Auto-detection** matters because packaged Electron apps get a minimal `PATH`. Check in this order:
  1. the configured path
  2. `~/.local/bin/codex`
  3. `/opt/homebrew/bin/codex`
  4. `/usr/local/bin/codex`
  5. `/Applications/ChatGPT.app/Contents/Resources/codex`
- `analysis-status.ts` gains provider-aware states, such as “Codex not signed in”, “Usage limit reached, resumes 14:30” or “Codex not found”. The MCP heartbeat messages apply only to `mcp-sampling`.
- **Default provider**: new workspaces start with `codex` if it is detected. Existing workspaces keep `mcp-sampling` until the user switches.

## Security

Codex is an agent, and saved code and notes flow into its prompt, so a note could contain instructions. Containment:

- Its working directory is an empty temp dir, with a read-only sandbox and no approvals.
- `--ignore-user-config` means no MCP servers. Codex can never call `save_review`, `finish_attempt` or any other tool that writes.
- The only output path is the final message, which goes through the existing validators: zod schemas, verbatim excerpt checks, citation and catalogue ID checks, and version checks.
- The worker has no scoring capability beyond what the existing review endpoints already allow.

Residual risk: a read-only sandbox still lets Codex _read_ files on disk. The only place it can put what it reads is its final message, which is stored locally. The spike must confirm that the sandbox blocks network access, and whether shell tools can be disabled entirely (see open questions).

## Privacy and cost

- **Data sent**: the same data already goes to OpenAI today via Hermes (`openai-codex`). `--ephemeral` avoids Codex session files (see the History note below).
- **Cost**: usage counts against the ChatGPT plan's limits.
  - Each `codex exec` run carries about 6.6k tokens of fixed Codex agent overhead. A one-word probe took 5 s and used 6,620 tokens on 2026-09-25.
  - The existing backfill is already complete (118 attempts, done via Hermes) and is not repeated on switching. It reruns only for changed attempts or an analysis-version bump.
  - Steady state is about three calls per new attempt: tutor report, attempt extraction and a learning report refresh. Topic analysis runs weekly. On a typical day that is roughly 6–9 calls, or 40–60k tokens of overhead.
  - Learning report regeneration after every attempt is kept as is. With `gpt-6-luna` the cost is acceptable. Reasoning effort, not call count, is the main latency driver.
  - The worker surfaces usage-limit pauses rather than retrying.
- **History**: verified on 2026-09-25 that an `--ephemeral`, `--ignore-user-config` run adds no Codex threads, turns, session files or prompt history, and the prompt text does not appear in `logs_2.sqlite`.

## Testing

This follows `docs/testing.md`, so only critical paths are tested. It uses a fake `codex` executable (a small Node script that returns fixture output or misbehaves on request), never the real CLI.

- **Runner unit tests**: argument set (including `--ignore-user-config` and stdin prompt), timeout kill, each error class, parsing of the output file and the model name.
- **Worker test**: one review job and one extraction job flow from queue to saved result using the fake CLI.
- **Gating test**: with provider `codex`, adapter claims get `null`, and the reverse.
- The existing learning-insights and auto-review tests pass unchanged after the `Generate` refactor.

## Plan

1. **Spike (manual, about 30 min)**: run `codex exec` with the flags above on a fixture extraction prompt. Confirm:
   - that `--ignore-user-config` drops MCP servers and `~/.codex/AGENTS.md`
   - that the sandbox blocks network access
   - that `--output-schema` accepts our zod-generated schemas (strict-mode needs)
   - which `--json` events carry the model name and usage
   - startup latency
2. **Refactor** the processors onto `Generate`, with no behaviour change.
3. **Runner and worker**: `codexGenerate`, the worker, the provider setting and claim gating.
4. **UI**: the Tutor model settings, Test button and status messages.
5. **Docs**: update `tutor-integration.md` and `desktop.md`, and keep the Hermes steps as the alternative.

## Open questions

- Can `codex exec` disable shell and tool use entirely, beyond a read-only sandbox?
- Does `--output-schema` enforce the schema server-side (strict), or is it only a hint? Our validators run either way.
- Does Codex offer a machine-readable usage-limit reset time, or must it be parsed from text?
- ~~Should the MCP adapter's sampling loop be removed once Codex is proven?~~ Removed on 2026-09-26.
