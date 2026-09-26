# Operations

See [README](../README.md#your-workspace) for platform defaults and legacy-directory preservation, and [Tutor integration](tutor-integration.md) for optional MCP clients. No client registration or spreadsheet cutover is required for a fresh workspace.

## Start and stop

Requires Node.js 22.23 or later, npm and the installed project dependencies. Each workspace has its own data directory.

```sh
cd /path/to/leetcode-tutor
npm ci
npm run build
npm run local
```

`npm run local` starts `dist/server/index.js`, waits for `/health` **and an authenticated settings read**, then opens `http://127.0.0.1:4317`. An already healthy app is reused. No LaunchAgent, login item, background agent service or Hermes configuration is installed. The server stays running after the command exits.

Defaults:

| Setting/file               | Value or purpose                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `DATA_DIR`                 | Platform default from the README; an existing macOS `LeetcodeTutor-dev` database is preserved |
| `PORT`                     | `4317`; loopback only                                                                         |
| `NODE_BINARY`              | Optional absolute Node executable for the shell launcher                                      |
| `NO_OPEN=1`                | Check/start without opening a browser                                                         |
| `DATA_DIR/leetcode.sqlite` | Live database; keep its WAL files with it                                                     |
| `DATA_DIR/api-token`       | Local bearer credential; never paste it in chat/config/logs                                   |
| `DATA_DIR/server.log`      | Launcher-started backend output                                                               |
| `DATA_DIR/server.pid`      | PID recorded by the launcher                                                                  |
| `DATA_DIR/launcher.lock`   | Short-lived startup lock                                                                      |

For foreground development use `npm run dev` (and, if needed, `npm run dev:web`). To stop a launcher-started server, inspect its PID and command using your process manager, then send **SIGTERM only to that verified Node process**. A PID file alone is not authority to kill a process: PIDs can be reused. Back up before upgrades; rebuild and restart afterwards.

If startup fails: check the log, missing build/dependencies, Node version, port occupancy and matching `DATA_DIR`. A healthy unrelated service on the same port is not accepted without the local credential. Do not disable auth or bind publicly. If a launch was forcibly interrupted, remove `launcher.lock` only after verifying that its launcher PID is no longer running. Export/output directories must already exist; the CLIs never silently overwrite an existing file.

## MCP adapter

The adapter uses the MCP SDK over stdio and forwards only named HTTP operations. Start the app first, then have an explicitly approved MCP client launch:

```sh
node /absolute/path/to/leetcode-tutor/dist/server/mcp.js
```

For development: `npm run mcp`. The client must supply the same `DATA_DIR` and `PORT` if defaults changed. Use an absolute Node executable if the client has a restricted PATH. Do **not** include the token in the MCP configuration; the adapter reads `api-token` locally. Stdout is reserved for the MCP protocol. Registration/cutover in Hermes remains a separate approval; these scripts do not perform it.

Tools: `get_today`, `search_questions`, `get_attempt_context`, `finish_attempt`, `save_review`, `set_review_date`. Search is limited to 100 results per page. There is no SQL, shell, arbitrary-URL fetch or judge. Searches reveal catalogue metadata; do not use them to peek at an active hidden assessment. Backend context restrictions still apply.

**Tutor reports for web submissions.** Saving a result in the web app queues the attempt for a report (in memory in the app process; a restart drops the queue and the learner can ask again from the attempt page). With Codex selected under **Settings → AI tutor**, the app's worker wakes as soon as the result is saved, runs Codex to write the report (up to 180 seconds) and saves it in-process with the same rules as the review endpoint, as the attempt's tutor note. It never changes scores. There are no HTTP endpoints for claiming tutor work, and the MCP adapter does no background work. Attempts finished by the tutor through `finish_attempt` are not queued: the tutor writes that note itself with `save_review`.

For finish/review writes, generate a unique idempotency key **once per intended operation**, retain it, and resend **identical** arguments/key after uncertain network delivery. Attempt and topic versions are mandatory. A 409 is a conflict, not permission to overwrite: fetch current state and reconcile. The adapter reads back committed attempts/context and returns both `committed` and `current`; a later current version may legitimately be newer than the idempotent committed response. `COMMITTED_READBACK_*` errors mean the write may already exist—do not create a new key. Tool failures return `isError: true` and structured error code/message; tokens are not logged.

## SQLite backup and recovery

The app backs up automatically when it starts if the last backup is more than a day old, and keeps the newest seven copies in `DATA_DIR/backups`. To take one by hand:

```sh
# Consistent SQLite backup, restricted by the backend to DATA_DIR/backups
npm run backup
```

`backup.ts` calls `/api/backup`, checks that the returned real path is directly inside `DATA_DIR/backups`, opens it read-only and runs SQLite `integrity_check` and `foreign_key_check`. It does not copy an active database file. Backups contain private notes and answers; keep them outside Git and store an encrypted/off-device copy if desired.

To recover, quit the app, keep the original data directory, and copy a verified backup into a **new** data directory as `leetcode.sqlite`. Start the app with that `DATA_DIR`, confirm representative answers, score decisions and dates, then switch to it. Never replace a live database or discard its WAL.

There is no JSON export/restore. `GET /api/export` remains as a read-only table dump that import tools use to verify what they applied.

## Verification

```sh
npx vitest run tests/integrations
npx eslint src/integrations scripts tests/integrations
npm run typecheck
```

Integration tests use temporary directories and loopback fake HTTP services, an actual SDK stdio client/child process, and SQLite integrity checks. The launcher test starts/reuses a temporary bundled service with browser opening disabled. These tests do not touch the real Sheet, pilot database or Hermes configuration.

## Pattern notebooks

The notebook is attached to every tag. Questions carry separate manually entered `leetcodeTopics` labels; these do not create or modify proficiency scores. Pattern membership and per-question difficulty continue to use `problem_tags`. Notebook fields live on the tag itself.

Every tag, including imported categories and formerly classified topic tags, has a notebook page. Legacy `kind` fields are kept but do not restrict notebook access or assignment. (The former standalone notebook table was merged into tags and then dropped by migration `0003_retire_sheet`.)

## Schema migrations

`openDb` applies the SQL migrations in `drizzle/`. When an existing database has migrations pending, it first saves a copy as `backups/before-migration-<time>.sqlite`; daily backup pruning never deletes these.
