# Python tutor

Python manages the tutor conversation through the [Codex Python SDK](https://learn.chatgpt.com/docs/codex-sdk).
BloomCode's existing TypeScript MCP server supplies platform tools. Python uses
an MCP client to prepare learner context; it defines no duplicate platform tools
or HTTP API client.

## Run

Requires Python 3.11+, Node.js matching the repository's requirements, and a
running BloomCode backend containing the latest changes in this worktree.
An older installed app will not have the new attempt-list endpoint.

From the worktree root:

```sh
npm ci
python3 -m venv python/.venv
python/.venv/bin/python -m pip install -r python/requirements.txt
python/.venv/bin/python python/chat.py \
  --api-url http://127.0.0.1:4317 \
  --token-file /absolute/path/to/data/api-token
```

Replace the token path with the `api-token` file beside your running server's
database. Dependencies are already installed in the development worktree.
The tutor reuses file-based Codex sign-in (`auth.json` in `CODEX_HOME`, normally
`~/.codex`). Keyring-only sign-in is not supported yet. Messages and retrieved
records are sent to Codex and use the signed-in account's usage.

Ask: **“For my latest Two Sum attempt, what changed in my help usage?”**
Or: **“What should I practise next, based on my recent attempts and learning insights?”**
No attempt ID is required. Enter `/quit` or press Ctrl+C to exit.
`--model MODEL` overrides the default `gpt-6-sol`. Without `--token-file`, the
conversation runs without platform tools. `--attempt ID` remains an optional
shortcut for starting a discussion about a known attempt.

During a reply, the terminal shows when the tutor searches for attempts or
retrieves context, and whether each tool call completes or fails. These updates
come from SDK events and contain no tool arguments or study records. The final
answer appears once the turn completes.

## Follow the code

- `chat.py`: terminal input and output.
- `tutor.py`: teaching instructions, Codex session, and dedicated MCP configuration.
- `learner_state.py`: loads recent attempts through MCP and calculates a compact snapshot.
- `../src/integrations/mcp.ts`: shared attempt, Learning Insights and evidence-search tools.
- `../src/server/attempts/attempts.ts`: lists completed attempts through the authenticated API.

`get_recent_attempts` returns summaries newest first, optionally filtered by
problem title (up to 20 results). `hasMore` indicates older matches. The tutor
passes a returned ID to `get_attempt_context`, which returns the existing
platform context, including code, history and topic scores. Ambiguous requests
can be clarified using titles and dates rather than internal IDs.

Before each turn with platform tools enabled, Python loads up to ten completed
attempts and calculates attempt count, distinct problem count, outcomes and help
usage. Unknown help stays unknown. The snapshot includes source IDs, dates,
short titles and a `hasMore` flag; it omits code and notes. It describes a recent
sample, not lifetime progress or mastery. Blocked or unavailable data is kept
distinct from an empty history, and every turn replaces the previous snapshot.

The learner message and snapshot are sent together as a JSON envelope. Teaching
instructions identify the snapshot as untrusted evidence, not instructions.
The MCP client starts a short-lived instance of the existing server per snapshot,
using the tutor's generated configuration and a 20-second timeout. This adds a
local process startup each turn; it does not make an extra model request.

For broader recommendations, the tutor can also read `get_learning_insights` and
query `retrieve_learning_evidence`. Instructions ask it to inspect at most three
relevant contexts (including topic scores), and retrieve up to five observations
per focused search. These additional calls have prompt limits, not a hard context
budget; existing attempt contexts can include full histories.
It should cite records, distinguish repeated practice from evidence across
problems, and acknowledge missing or stale analysis. When Insights is unavailable,
it can still make provisional suggestions from attempt records. Topic scores
come from selected contexts; this is not a complete overview of every topic.

Only those four tools are allowlisted for this tutor; the shared server's write
tools are not exposed. General-purpose Codex tools and web search are disabled.
The API still enforces authentication and assessment visibility. The MCP process
holds the existing broad local API credential; server-side scoped credentials
remain production hardening work. User MCP configuration is not modified.

## Saved conversations

Closing the terminal preserves the conversation. Run the same command again to
resume it automatically. Add `--new` to start a fresh chat; older Codex threads
remain stored. The last-conversation pointer changes after a completed reply,
so opening an empty new chat does not replace it.

Storage defaults to a `tutor` directory beside the supplied API token. Without
platform tools, it uses the repository's ignored `private/tutor` directory.
Use `--state-dir /absolute/path` to override it. Keep separate storage per study
workspace; a saved conversation cannot resume with a different token-file path.
Run one tutor process per storage directory at a time.

Codex owns the saved thread history in `codex-home`; `last-session.json` holds
the thread ID. The private directory also contains our tool configuration and
credential symlinks. BloomCode's database-only backup does not include these
conversation files. Back up the tutor storage separately if needed. Resume
errors are reported rather than silently starting a replacement chat.

Persistent learner goals across chats, answer-text streaming, context budgeting and
teaching-quality evaluations remain later work.

## Verify

```sh
python/.venv/bin/python -m unittest discover -s python -p 'test_*.py'
node --import tsx tests/integrations/python-context.mjs
```

This starts the real TypeScript MCP server against a disposable BloomCode
database and tests listing, filtering, retrieval, snapshot facts and assessment restrictions.
Add `--live` to verify that Codex uses the snapshot, retrieves context, saves the
conversation and recommends practice across problems with Insights disabled.
That option consumes signed-in account usage.

To verify persistence across separate Python processes in disposable storage:

```sh
python/.venv/bin/python python/check_resume.py
```

This is a live Codex check and consumes signed-in account usage.
