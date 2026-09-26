# Backend implementation notes

## Layout

- `core/`: process entry points (`index.ts`, `desktop.ts`), `app.ts`, which wires the feature modules, and the local credential (`auth.ts`).
- `db/`: the SQLite connection and query helpers (`db.ts`), the schema (`schema.ts`), settings, `ApiError`, idempotent replay and new-tag hues. Every other folder builds on this one.
- `attempts/`, `scoring/`, `plans/`, `catalogue/` (including imports and first-run setup), `topics/`, `transfer/` (backups), `insights/` and `tutor/`: feature modules. `tutor/` holds the Codex worker and its jobs (tutor reports, learning insights, topic picks), which call the queues and services directly.
- Shared records, views, queries and rules live in model files with no routes: `attempts/attempt-model.ts`, `attempts/attempt-context.ts`, `attempts/auto-review-queue.ts`, `attempts/review-schedule.ts`, `scoring/review-model.ts`, `catalogue/problem-model.ts`, `catalogue/list-projection.ts`, `topics/topic-model.ts` and `plans/plan-model.ts`. Route files (`registerX`) import these and are imported only by `core/app.ts`. Keep it that way: when two features need the same helper, put it in a model file, not in either route file. The server has no import cycles.
- `paths.ts` resolves the repository root for runtime files (`dist/web/`, manifests). It must stay directly under `src/server`, the same depth as the bundled `dist/server/*.js`.

## Runtime

`createApp({ dbPath, token?, serveStatic?, clock? })` returns an awaited Fastify instance. `serveStatic: true` serves `dist/web`; a string is an optional internal/test static-root override. `clock` is a `() => Date`. `openDb(path)` returns the `better-sqlite3` connection; the caller owns closing it. The app closes its connection on `app.close()`.

`src/server/core/index.ts` listens only on `127.0.0.1`, uses `PORT=4317` by default and stores the database under `DATA_DIR`, defaulting to the platform directory listed in the [README](../../README.md#your-workspace) (an existing macOS `LeetcodeTutor-dev` database is kept). It never seeds study data.

The first boot creates a 0600 `api-token` in a 0700 data directory. It is never returned to the browser. Same-origin browser sessions use HttpOnly/SameSite=Strict cookies and per-session CSRF tokens; import and backup always require the local bearer credential. Requests validate loopback remote address, Host, actual listening port and exact Origin. Serve the built UI from this server for the production same-origin flow.

## Persistence

`db/schema.ts` is the whole schema. `openDb` creates it in a new database (`user_version` 0, then 7) and leaves an existing one alone; there are no migrations. A schema change must also alter existing databases, so add that step to `openDb` when one is needed. The one such step today converts a version 6 database's `learning_insights` JSON records into the insight tables (`INSIGHTS_TO_TABLES`); delete it once no version 6 database remains.

Tables are typed: `db/schema.ts` is the schema to read. Column names match the TypeScript fields, so `SELECT *` returns API-shaped rows; booleans are 0/1 and a few small lists and nested objects (`leetcodeTopics`, `mistakeLabels`, settings `recommendations`, insight jobs' and reports' `evidenceIds`, report `findings`, the topic-analysis `report`) are JSON text. Values another table already holds are never copied: a problem's latest attempt, solve time, attempt count and review date, an attempt's problem, and a decision's topic name are joined or computed in the model files' queries. CHECK constraints, foreign keys, unique names/slugs/days and a partial unique index (one active or paused attempt) hold the rules. Learning insights have one table per record: `insight_jobs`, `insight_observations`, `insight_corrections` (a dismissal of one observation), `insight_reports` and the single-row `topic_analysis`; whether insights are on is `settings.insightsEnabled`. Current, undismissed observations are selected in SQL. Imported source rows keep their original `raw` JSON. Scores are absolute decimal values (at most two decimal places), never accumulated deltas.

Queries use `one`/`maybe`/`many`/`run` and `insert`/`update` from `db/db.ts`. Several lists are shown in the order rows were written, so those queries order by `rowid`.

There is no JSON restore: recovery means opening a SQLite backup as the database. Backups use SQLite's online backup API, generate their own filename only inside the private `backups/` directory and update `lastBackupAt` after success.

## Behavioural rules

- Draft/timer mutations require an exact optimistic version. Finish and tutor review also require a stable `Idempotency-Key`; same key/different canonical payload conflicts, while identical retries return the committed response even after restart or with a stale original version.
- Timer heartbeat intervals up to 120 seconds count as active work. A longer interval pauses at the last heartbeat and requires `includeGap: true|false` on resume. Unknown final or imported duration stays null.
- Interval rules v1: failed/stopped or major/solution/unknown help → repair in 1 day; a solved small-help attempt → reconstruction in 3 days; independent retention → transfer in 7 days; other independent solves → mixed practice in 14 days. Manual/snoozed/no-review targets are never overwritten by recommendations.
- Existing exposure, legacy completion, prior attempts or explicit review context are retention. A first targeted attempt is near-transfer; only first mixed attempts are unseen. A new score increase above 3 requires a solved, unassisted unseen/mock attempt. Unchanged historical scores above 3 remain valid and retain provisional status. No completion-driven score changes or calendar decay exist.
- Daily plans are persisted and stable by study date/timezone. Active attempts resume across midnight. Due reviews precede weak-topic/coverage candidates, then the least recently practised. Assignment skip/swap/snooze creates no attempt evidence. New plans use the daily question target without a time-budget cap; all questions belong to the main queue. Legacy settings fall back to the sum of primary and optional counts.
- Imports consume canonical supplied data and never access or mutate Sheets. Dry runs roll back their reconciliation transaction. Reusing an applied import ID with identical data is a no-op; different data conflicts. Raw unresolved records are retained, unknown timing stays null, current imported scores are not replayed from historical movements, and existing topic scores are not silently overwritten by later imports.

## Verification

`npm exec vitest run tests/server` exercises temporary on-disk SQLite databases, Fastify inject and a real loopback child server. It covers catalogue filters and bucket boundaries, hidden-safe attempts, restart/timer recovery, transactional finish/review rollback and idempotency, scoring evidence, scheduling, import reconciliation, export and backup, native backups, browser/MCP authentication and static serving. No test writes the pilot database, live workbook or Hermes configuration.
