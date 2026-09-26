# Operations

See the [README](../README.md#your-workspace) for workspace locations and [Tutor integration](tutor-integration.md) for MCP clients.

## Start and stop

Open BloomCode, or run `npm run electron:dev` from source (see [Desktop](desktop.md)). The app starts its backend on `127.0.0.1:4317` and stops it on quit. Only one server can open a data directory at a time.

| Setting/file               | Value or purpose                                                         |
| -------------------------- | ------------------------------------------------------------------------ |
| `DATA_DIR`                 | Platform default (see README); a pre-rename workspace keeps its location |
| `PORT`                     | `4317`; loopback only                                                    |
| `DATA_DIR/leetcode.sqlite` | Live database; keep its WAL files with it                                |
| `DATA_DIR/api-token`       | Local bearer credential; never paste it in chat/config/logs              |
| `DATA_DIR/server-locks/`   | Marks the server that has the workspace open                             |

For the browser-only development loop (`npm run dev` and `npm run dev:web`), see [Contributing](../CONTRIBUTING.md#development).

## MCP adapter

The adapter speaks MCP over stdio and forwards only named HTTP operations. Start the app, then have your MCP client launch:

```sh
node /absolute/path/to/bloomcode/dist/server/mcp.js
```

For development, use `npm run mcp`. If you changed the defaults, the client must pass the same `DATA_DIR` and `PORT`. Use an absolute Node path if the client has a restricted PATH. Do not put the token in the MCP configuration; the adapter reads `api-token` itself. Stdout is reserved for the MCP protocol.

Tools: `get_today`, `search_questions`, `get_attempt_context`, `finish_attempt`, `save_review`, `set_review_date`, `get_learning_insights` and `retrieve_learning_evidence`. Search returns at most 100 results per page. There is no SQL, shell, URL fetch or code judge. The backend hides assessment details while a mixed assessment is active.

**Tutor reports.** Saving a result queues the attempt for a report. The queue lives in memory, so after a restart you request the report again from the attempt page. With Codex selected under **Settings → AI tutor**, the app runs Codex (up to 180 seconds) and saves the result as the attempt's tutor note, using the same rules as the review endpoint. Reports never change scores. The MCP adapter does no background work; attempts finished through `finish_attempt` are not queued, because the client writes that note with `save_review`.

For finish and review writes, generate one idempotency key per intended operation and resend the identical arguments and key if delivery is uncertain. Attempt and topic versions are required. A 409 means re-read and reconcile, not overwrite. The adapter reads back committed results and returns both `committed` and `current`; `current` may be newer. A `COMMITTED_READBACK_*` error means the write may already exist, so keep the same key. Tool failures return `isError: true` with a code and message; tokens are never logged.

## SQLite backup and recovery

The app backs up automatically when it starts if the last backup is more than a day old, and keeps the newest seven copies in `DATA_DIR/backups`. To take one by hand:

```sh
npm run backup
```

`npm run backup` asks the running app for an online SQLite backup, checks that it landed in `DATA_DIR/backups`, and runs `integrity_check` and `foreign_key_check` on it. Backups contain your notes and code, so keep them out of Git.

To recover, quit the app and copy a backup into a **new** data directory as `leetcode.sqlite`. Start the app with that `DATA_DIR`, check a few attempts, scores and dates, then switch to it. Keep the original directory, and never replace a live database or discard its WAL files. The SQLite backup is the portable copy; there is no JSON export.

## Verification

```sh
npx vitest run tests/integrations
npx eslint src/integrations scripts tests/integrations
npm run typecheck
```

Integration tests use temporary directories, loopback HTTP services, a real MCP stdio client and SQLite integrity checks.

## Pattern notebooks

Every tag has a notebook page, whatever its `kind`; notebook fields live on the tag. Pattern membership uses `problem_tags`. A question's `leetcodeTopics` labels are separate and never affect scores.

## Schema

`src/server/db/schema.ts` is the whole schema. `openDb` creates it in a new database and upgrades an existing one only through explicit steps in `openDb`.
