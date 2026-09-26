# Backend implementation notes

## Layout

- `core/`: process entry points (`index.ts`, `desktop.ts`), `app.ts`, which wires the feature modules, and the local credential (`auth.ts`).
- `db/`: SQLite connection and migrations, schema, `Store`, `ApiError`, idempotent replay and new-tag hues. Every other folder builds on this one.
- `attempts/`, `scoring/`, `plans/`, `catalogue/` (including imports and first-run setup), `topics/`, `transfer/` (read-only export and backup), `insights/` and `tutor/`: feature modules. `tutor/` holds the Codex worker and its jobs (tutor reports, learning insights, topic picks), which call the queues and services directly.
- Shared records, views and rules live in model files with no routes: `attempts/attempt-model.ts`, `attempts/attempt-context.ts`, `attempts/auto-review-queue.ts`, `attempts/review-schedule.ts`, `scoring/review-model.ts`, `catalogue/problem-model.ts`, `catalogue/list-projection.ts`, `topics/topic-model.ts` and `plans/plan-model.ts`. Route files (`registerX`) import these and are imported only by `core/app.ts`. Keep it that way: when two features need the same helper, put it in a model file, not in either route file. The server has no import cycles.
- `paths.ts` resolves the repository root for runtime files (`drizzle/`, `dist/web/`, manifests). It must stay directly under `src/server`, the same depth as the bundled `dist/server/*.js`.

## Runtime

`createApp({ dbPath, token?, serveStatic?, clock? })` returns an awaited Fastify instance. `serveStatic: true` serves `dist/web`; a string is an optional internal/test static-root override. `clock` is a `() => Date`. `openDb(path)` returns `{ sqlite, orm }`; the caller owns closing the SQLite connection. The app closes its connection on `app.close()`.

`src/server/core/index.ts` listens only on `127.0.0.1`, uses `PORT=4317` by default and stores the database under `DATA_DIR`, defaulting to `~/Library/Application Support/LeetcodeTutor-dev`. It never seeds study data. Both source execution (`tsx src/server/core/index.ts`) and the bundled server expect the repository's `drizzle/` directory alongside `src/` or `dist/`.

The first boot creates a 0600 `api-token` in a 0700 data directory. It is never returned to the browser. Same-origin browser sessions use HttpOnly/SameSite=Strict cookies and per-session CSRF tokens; import and backup always require the local bearer credential. Requests validate loopback remote address, Host, actual listening port and exact Origin. Serve the built UI from this server for the production same-origin flow.

## Persistence and migration

Drizzle's tracked migration is `drizzle/0000_initial.sql` with its `_journal.json`. `db/schema.ts` describes the tables. Durable entity payloads are JSON columns with real SQLite foreign-key columns for their relationships, unique pair/name/slug/day indexes and a partial unique index preventing two active or paused attempts. API validation constrains payload values. Scores are absolute decimal values (at most two decimal places), never accumulated deltas.

`db/db.ts` exports the authoritative **durableTables** export allowlist: settings, problems, tags, lists, problem_tags, list_memberships, attempts, review_targets, answer_versions, audit_events, topics, score_decisions, attempt_topics, import_batches, import_records, daily_plans, plan_items and learning_insights. Exports contain decoded rows with stable IDs, not SQLite implementation columns. Credentials, browser sessions, migration bookkeeping and idempotency responses are excluded. The native SQLite backup retains the complete database, including idempotency state.

There is no JSON restore: recovery means opening a SQLite backup as the database. Backups use SQLite's online backup API, generate their own filename only inside the private `backups/` directory and update `lastBackupAt` after success.

## Behavioural rules

- Draft/timer mutations require an exact optimistic version. Finish and tutor review also require a stable `Idempotency-Key`; same key/different canonical payload conflicts, while identical retries return the committed response even after restart or with a stale original version.
- Timer heartbeat intervals up to 120 seconds count as active work. A longer interval pauses at the last heartbeat and requires `includeGap: true|false` on resume. Unknown final or imported duration stays null.
- Interval rules v1: failed/stopped or major/solution/unknown help → repair in 1 day; a solved small-help attempt → reconstruction in 3 days; independent retention → transfer in 7 days; other independent solves → mixed practice in 14 days. Manual/snoozed/no-review targets are never overwritten by recommendations.
- Existing exposure, legacy completion, prior attempts or explicit review context are retention. A first targeted attempt is near-transfer; only first mixed attempts are unseen. A new score increase above 3 requires a solved, unassisted unseen/mock attempt. Unchanged historical scores above 3 remain valid and retain provisional status. No completion-driven score changes or calendar decay exist.
- Daily plans are persisted and stable by study date/timezone. Active attempts resume across midnight. Due reviews precede weak-topic/coverage candidates, then the least recently practised. Assignment skip/swap/snooze creates no attempt evidence. New plans use the daily question target without a time-budget cap; all questions belong to the main queue. Legacy settings fall back to the sum of primary and optional counts.
- Imports consume canonical supplied data and never access or mutate Sheets. Dry runs roll back their reconciliation transaction. Reusing an applied import ID with identical data is a no-op; different data conflicts. Raw unresolved records are retained, unknown timing stays null, current imported scores are not replayed from historical movements, and existing topic scores are not silently overwritten by later imports.

## Verification

`npm exec vitest run tests/server` exercises temporary on-disk SQLite databases, Fastify inject and a real loopback child server. It covers catalogue filters and bucket boundaries, hidden-safe attempts, restart/timer recovery, transactional finish/review rollback and idempotency, scoring evidence, scheduling, import reconciliation, export and backup, native backups, browser/MCP authentication, static serving and migration tracking. No test writes the pilot database, live workbook or Hermes configuration.
