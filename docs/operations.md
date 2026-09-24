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

Alternatively double-click **scripts/LeetCode Tutor.command** in Finder. This starts `dist/server/index.js`, waits for `/health` **and an authenticated settings read**, then opens `http://127.0.0.1:4317`. An already healthy app is reused. No LaunchAgent, login item, background agent service or Hermes configuration is installed. The server stays running after the launcher exits.

Defaults:

| Setting/file | Value or purpose |
|---|---|
| `DATA_DIR` | Platform default from the README; an existing macOS `LeetcodeTutor-dev` database is preserved |
| `PORT` | `4317`; loopback only |
| `NODE_BINARY` | Optional absolute Node executable for the shell launcher |
| `NO_OPEN=1` | Check/start without opening a browser |
| `DATA_DIR/leetcode.sqlite` | Live database; keep its WAL files with it |
| `DATA_DIR/api-token` | Local bearer credential; never paste it in chat/config/logs |
| `DATA_DIR/server.log` | Launcher-started backend output |
| `DATA_DIR/server.pid` | PID recorded by the launcher |
| `DATA_DIR/launcher.lock` | Short-lived startup lock |

For foreground development use `npm run dev` (and, if needed, `npm run dev:web`). To stop a launcher-started server, inspect its PID and command using your process manager, then send **SIGTERM only to that verified Node process**. A PID file alone is not authority to kill a process: PIDs can be reused. Back up before upgrades; rebuild and restart afterwards.

If startup fails: check the log, missing build/dependencies, Node version, port occupancy and matching `DATA_DIR`. A healthy unrelated service on the same port is not accepted without the local credential. Do not disable auth or bind publicly. If a launch was forcibly interrupted, remove `launcher.lock` only after verifying that its launcher PID is no longer running. Export/output directories must already exist; the CLIs never silently overwrite an existing file.

## MCP adapter

The adapter uses the MCP SDK over stdio and forwards only named HTTP operations. Start the app first, then have an explicitly approved MCP client launch:

```sh
node /absolute/path/to/leetcode-tutor/dist/server/mcp.js
```

For development: `npm run mcp`. The client must supply the same `DATA_DIR` and `PORT` if defaults changed. Use an absolute Node executable if the client has a restricted PATH. Do **not** include the token in the MCP configuration; the adapter reads `api-token` locally. Stdout is reserved for the MCP protocol. Registration/cutover in Hermes remains a separate approval; these scripts do not perform it.

Tools: `get_today`, `search_questions`, `get_attempt_context`, `finish_attempt`, `save_review`, `set_review_date`. Search is limited to 100 results per page. There is no SQL, shell, arbitrary-URL fetch or judge. Searches reveal catalogue metadata; do not use them to peek at an active hidden assessment. Backend context restrictions still apply.

**Tutor reports for web submissions.** Saving a result in the web app queues the attempt for a report (in memory in the app process; a restart drops the queue and the learner can ask again from the attempt page). When the connected client supports MCP sampling and `TUTOR_AUTO_REVIEW` is not `0`, the adapter polls `POST /api/auto-reviews/claim` every 3 s, asks the client's model to write the report (`sampling/createMessage`, one request per attempt) and saves it through the normal review endpoint as the attempt's tutor note. It never changes scores. Claims are bearer-only and leased for 3 minutes to coordinate multiple adapter processes. The adapter allows up to 180 seconds for sampling; a client may enforce a shorter limit. Configure that limit in your client if reports time out. Attempts finished by the tutor through `finish_attempt` are not queued: the tutor writes that note itself with `save_review`.

For finish/review writes, generate a unique idempotency key **once per intended operation**, retain it, and resend **identical** arguments/key after uncertain network delivery. Attempt and topic versions are mandatory. A 409 is a conflict, not permission to overwrite: fetch current state and reconcile. The adapter reads back committed attempts/context and returns both `committed` and `current`; a later current version may legitimately be newer than the idempotent committed response. `COMMITTED_READBACK_*` errors mean the write may already exist—do not create a new key. Tool failures return `isError: true` and structured error code/message; tokens are not logged.

## Portable export, SQLite backup and empty-only restore

```sh
# Private, exclusive-create JSON export of all durable user tables
npm run export -- --output /absolute/existing-directory/tutor-export.json

# Consistent SQLite backup, restricted by the backend to DATA_DIR/backups
npm run backup

# Separate fresh restore workspace (POSIX shell; use PowerShell $env:NAME on Windows)
DATA_DIR=/absolute/new-restore-directory PORT=4318 NO_OPEN=1 npm run local
DATA_DIR=/absolute/new-restore-directory PORT=4318 npm run restore -- \
  --input /absolute/existing-directory/tutor-export.json --confirm-empty
```

`backup.ts` calls `/api/backup`, checks that the returned real path is directly inside `DATA_DIR/backups`, opens it read-only and runs SQLite `integrity_check` and `foreign_key_check`. It does not copy an active database file.

`export.ts` calls `/api/export`; `restore.ts` sends `{snapshot, confirmEmpty:true}` to `/api/restore`. The backend enforces schema/table validation, transactionality and empty-only restoration. The restore CLI then exports the target again and compares **every table and row**, ignoring only the top-level export timestamp and row/key ordering. A mismatch is an error, never a successful restore. Source exports are created with mode 0600 and `wx` (existing files and symlinks are refused). They contain private notes, answers and raw Sheet provenance; keep them outside Git and store an encrypted/off-device copy if desired.

The portable restore CLI accepts JSON, not `.sqlite`. For binary disaster recovery, retain the original directory, stop the service, and copy a verified SQLite backup to a **new** data directory as `leetcode.sqlite` before starting that isolated instance. Never replace a live database or discard its WAL. A successful integrity check is not a full recovery drill: reopen the restored app and confirm representative answers, score decisions, relationships and dates before cutover.

## Verification

```sh
npx vitest run tests/integrations
npx eslint src/integrations scripts tests/integrations
npm run typecheck
```

Integration tests use temporary directories and loopback fake HTTP services, an actual SDK stdio client/child process, and SQLite integrity checks. The launcher test starts/reuses a temporary bundled service with browser opening disabled. These tests do not touch the real Sheet, pilot database or Hermes configuration.

## Pattern notebook consolidation

The notebook is attached to every tag. Questions carry separate manually entered `leetcodeTopics` labels; these do not create or modify proficiency scores. Pattern membership and per-question difficulty continue to use `problem_tags`. Notebook fields live on the tag itself.

At startup and on portable restore, former standalone notebook entries merge into tags by case-insensitive, trimmed name. Missing tags are created, distinct notes are retained, and former example links become tag assignments without overwriting existing difficulty values. The old `patterns` table remains empty for backup compatibility. This upgrade runs transactionally and is idempotent. Every tag, including imported categories and formerly classified topic tags, has a notebook page. Legacy kind fields remain compatible with backups but do not restrict notebook access or assignment. No reclassification is needed.
