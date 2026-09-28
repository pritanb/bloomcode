# Python tutor

Python manages the tutor conversation through the [Codex Python SDK](https://learn.chatgpt.com/docs/codex-sdk).
BloomCode's existing TypeScript MCP server supplies platform tools. Python uses
an MCP client to prepare learner context; it defines no duplicate platform tools
or HTTP API client.

## Run

### Inside BloomCode

After installing the dependencies below, run `npm run build` and restart the
BloomCode backend. Click **Ask your tutor** from any screen, or **Talk to your tutor**
on the study desk. The floating panel stays with you as you navigate; minimising
it preserves your draft and lets a running response finish. Escape minimises
the panel when focus is inside it. Completed attempts also have **Discuss with tutor**.

Click **Open tutor** to resume the last completed conversation. Activity and
answer text appear as the worker runs. Cited attempt IDs link to verified saved
attempts. Proposed goal/preference changes have **Confirm and save** and
**Discard** buttons; plain chat agreement cannot bypass those controls.

**Stop** cancels a running request, and **Close tutor** releases the session for
the terminal client. Reopen to resume completed turns. **New conversation** starts
fresh while retaining saved goals and preferences. The backend pauses tutor access
during any active attempt, terminates an in-flight reply when practice starts,
and hides conversation results until practice finishes or is cancelled.

Fastify starts `python/worker.py` only when requested and communicates using a
versioned JSON-lines protocol. The worker uses the same tutor as the terminal.
The UI polls the backend every half-second while visible to display streaming
updates. Requests time out after three minutes. A process lock prevents the app
and terminal from writing the same session concurrently. Worker crashes do not
affect saved study work. Set `BLOOMCODE_PYTHON` to an absolute Python executable
if the environment is installed somewhere other than `python/.venv`.

`npm run electron:dev` sets `BLOOMCODE_TUTOR_ROOT` to the source worktree so the
staged Electron backend can find both `python/worker.py` and its virtual
environment. Restart that command after launcher/backend changes. A Python
executable override alone cannot supply missing worker files. Desktop packaging
still does not bundle the Python runtime; this development path is not a packaged
release solution.

### Terminal and development setup

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
`--model MODEL` overrides the ordinary-chat default `gpt-6-sol`. Without `--token-file`, the
conversation runs without platform tools. `--attempt ID` remains an optional
shortcut for starting a discussion about a known attempt.

During a reply, the terminal shows when the tutor searches for attempts or
retrieves context, and whether each tool call completes or fails. These updates
come from SDK events and contain no tool arguments or study records. The final
answer appears once the turn completes.

## Architecture

See the [architecture diagrams](../docs/architecture/README.md#bloom-ai-tutor) for
the app-to-Python flow, evidence retrieval, coaching loop and storage boundaries.

## Follow the code

```text
python/
├── chat.py                 # Terminal entry point
├── worker.py               # App subprocess entry point
├── bloom_tutor/            # Runtime implementation
│   ├── session.py          # Codex session, instructions and proposals
│   ├── answer_graph.py     # Snapshot → evidence → ordinary answer
│   ├── learner_state.py    # MCP access and learner snapshot
│   ├── goal_progress.py    # Deterministic goal progress facts
│   ├── session_lock.py     # Protect shared session storage
│   └── coaching/
│       ├── controller.py   # Explicit coaching commands and handoffs
│       ├── graph.py        # Durable teaching loop and checkpoints
│       ├── evidence.py     # Retrieve and compact supporting records
│       └── model.py        # Structured Codex teaching decisions
├── tests/                  # Fast, offline unit tests
├── evals/                  # Explicit live comparisons and resume check
│   ├── evaluate_answers.py
│   ├── evaluate_coaching.py
│   ├── check_resume.py
│   └── scenarios.json
└── requirements.txt
```

Start with `chat.py` or `worker.py`, then follow `bloom_tutor/session.py` into
`answer_graph.py` for ordinary chat or `coaching/controller.py` for coaching.
The shared platform tools remain in `../src/integrations/mcp.ts`; Python does
not duplicate them. The app and terminal launch commands are unchanged.

Run unit tests with the command below. Live evaluation fixtures configure the
Python import path automatically; use `npm run eval:tutor` for coaching and
`node --import tsx tests/integrations/answer-evidence.mjs --live` for answers.

`get_recent_attempts` returns summaries newest first, optionally filtered by
problem title (up to 20 results). `hasMore` indicates older matches. The tutor
passes a returned ID to `get_attempt_context`, which returns the existing
platform context, including code, history and topic scores. Ambiguous requests
can be clarified using titles and dates rather than internal IDs.

For ordinary chat turns with platform tools enabled, Python loads up to ten completed
attempts and calculates attempt count, distinct problem count, outcomes and help
usage. Unknown help stays unknown. The snapshot includes source IDs, dates,
short titles and a `hasMore` flag; it omits code and notes. It describes a recent
sample, not lifetime progress or mastery. Blocked or unavailable data is kept
distinct from an empty history, and every turn replaces the previous snapshot.

The learner message and snapshot are sent together as a JSON envelope. Teaching
instructions identify the snapshot as untrusted evidence, not instructions.
The MCP client starts a short-lived instance of the existing server per snapshot,
using the tutor's generated configuration and a 30-second timeout. This adds a
local process startup each turn; it does not make an extra model request.

For broader recommendations, the tutor can also read `get_learning_insights` and
query `retrieve_learning_evidence`. Instructions ask it to inspect at most three
relevant contexts (including topic scores), and retrieve up to five observations
per focused search. These additional calls have prompt limits, not a hard context
budget; existing attempt contexts can include full histories.
It should cite records, distinguish repeated practice from evidence across
problems, and acknowledge missing or stale analysis. When Insights is unavailable,
it can still make provisional suggestions from attempt records. Topic scores
are also included directly in the snapshot through `get_topic_scores`. It returns
up to twenty topics, lowest recorded scores first and unscored topics last,
plus total/unscored counts and a truncation flag. Provisional scores remain
marked, and null means unknown. No topic notes or attempt histories are fetched
for this step. A denied score read discards the snapshot; an ordinary API error
marks topic scores unavailable while retaining the recent-attempt summary.

The tutor also has goal and teaching-preference read/proposal tools. Only these
nine tools are allowlisted. Proposals do not write to the database. General-purpose
Codex tools and web search are disabled. The model's MCP process uses `tutor-token`,
a restricted credential accepted only for the specific learning reads and evidence
search. It cannot mutate goals, scores, schedules, settings or study work, even if
a write tool is accidentally exposed. Restart the updated backend once to create
this credential beside `api-token`. User MCP configuration is not modified.

## Learning goals

Ask: **"Propose a goal to solve two distinct sliding-window problems without hints."**
The tutor prepares a proposal; Python displays the exact change after the answer.
Type `yes` to save it, or press Enter to discard it. Ordinary conversational agreement
does not bypass this confirmation. The host uses the full local credential only
for the confirmed change; the model does not receive that credential.

Goals live in BloomCode's SQLite database with state, version, timestamps and the
originating Codex conversation ID. Active goals load into every learner snapshot,
including after `--new`. Ask to complete or abandon a goal to propose a state change;
those changes also require confirmation.

Ask **"How am I progressing on my goal?"** Python retrieves up to twenty completed
attempts begun since the original agreement for each of the three most recently
updated active goals. It computes distinct problems, recorded outcomes, help usage,
and distinct problems recorded as solved without help. Repeats count once; unknown
help does not count as independent work. Earlier starts and uncertain timestamps
are excluded, and truncated evidence is flagged. These are activity facts, not a
completion verdict: the tutor still needs evidence that the problems match the
goal's topic and conditions. It should ask when that cannot be established. This
does not change scores, schedules or goal state automatically.

Retries use the same idempotency key, equivalent active goals are deduplicated,
and stale state changes are rejected. If confirmation fails, `/confirm` retries
the pending change safely or lets you discard it. Pending proposals last only for
the current Python process; confirmed goals survive restarts. Goals are included
in native database backups; their source conversation reference does not include
the conversation transcript. Uninstalling or resetting conversation storage does
not remove the saved goals.

## Teaching preferences and corrections

Ask **"Remember that I prefer detailed explanations and question-based hints."**
Review the proposed values and type `yes` to save. Supported values are:

- Explanation depth: `concise`, `balanced`, or `detailed`.
- Hint style: `questions`, `progressive`, or `direct`.

`questions` uses focused diagnostic questions, `progressive` reveals hints one at
a time, and `direct` gives guidance without requiring a quiz. Defaults are concise
and progressive; they are not labelled as learner-confirmed until you save them.

To correct a preference, say **"Remember concise explanations and direct hints instead."**
Every snapshot loads the latest values from SQLite, including in resumed or new
conversations. Current values supersede older chat history. A request such as
"be brief for this answer" only overrides the current turn. A preference you did
not ask to change should be preserved in the proposal shown for confirmation.

Preferences share the goal confirmation safeguards: the model cannot save them,
retries are duplicate-safe, stale changes are rejected, and `/confirm` retries a
pending save. They are included in database backups with the source conversation
and update time. This stores explicit teaching choices, not inferred diagnoses.

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

Structured goal criteria and a hard context budget across all model tool calls
remain later work. Ordinary answers stream text; coaching responses appear after
validation. Explicit before/after evaluations are documented below.

## Verify

```sh
python/.venv/bin/python -m unittest discover -s python/tests -t python -p 'test_*.py'
node --import tsx tests/integrations/python-context.mjs
```

This starts the real TypeScript MCP server against a disposable BloomCode
database and tests listing, filtering, retrieval, snapshot facts and assessment restrictions.
Add `--live` to verify that Codex uses the snapshot, retrieves context, saves the
conversation and recommends practice across problems with Insights disabled.
That option consumes signed-in account usage.

To verify persistence across separate Python processes in disposable storage:

```sh
python/.venv/bin/python python/evals/check_resume.py
```

This is a live Codex check and consumes signed-in account usage.

To verify a real goal proposal, host confirmation and recall in a fresh conversation:

```sh
node --import tsx tests/integrations/python-context.mjs --live-goals
node --import tsx tests/integrations/python-context.mjs --live-progress
node --import tsx tests/integrations/python-context.mjs --live-preferences
```

This also uses disposable data and signed-in account usage.

## Current limits

- This is the local development integration. Python, its dependencies, Node/tsx
  and file-based Codex sign-in must already be installed. The desktop installer
  does not yet bundle the Python runtime or support every authentication method.
- One conversation is active at a time. The UI shows the last 100 messages from
  completed turns. Conversation listing, export/import and retention controls are
  not implemented. Codex history is separate from SQLite backups.
- Interrupted answers and unconfirmed proposals are not restored after the worker
  closes. A confirmed database write is not undone by pressing Stop; refreshed
  goals/preferences show its current state.
- Context is bounded, and goal relevance still needs interpretation. The tutor
  does not autonomously score work, change schedules, diagnose learning difficulties,
  or coach active practice. Existing live scenarios verify key behaviors but are
  not a comprehensive benchmark of teaching quality.

## Evidence-first answers (LangGraph)

Ordinary messages now run through `bloom_tutor/answer_graph.py` before the existing Codex
chat turn: **snapshot → retrieve and inspect evidence → answer**. This is also
used when active coaching hands a message back to chat. It adds no classifier or
planning model call. Codex still streams the answer, keeps conversation history,
and owns optional tool calls and learner-confirmed goal/preference proposals.

The graph uses the existing `retrieve_learning_evidence` MCP tool twice: the
question itself, then a bounded search for strengths and counterexamples. It
keeps up to five observations across both polarities and inspects up to three
linked/current attempts. Observation excerpts must still occur in the current
source field; mismatches are excluded. Code, notes and takeaways are truncated
with explicit flags. The answer receives coverage and retrieval limitations.
Similarity alone does not establish relevance or a learning difficulty; the
model must compare supporting and conflicting evidence and cite attempt IDs.

Learning Insights must be enabled and its embedding index ready. Disabled,
loading or failed search is labelled unavailable, not an empty history. The tutor
can still use its ordinary snapshot and tools to fill specific gaps. All ordinary
messages take this path, including general questions; this avoids a classifier
but adds local retrieval work. Current code/notes are untrusted evidence. No
study records, scores, schedules or preferences are changed by retrieval.

Short follow-ups include the last substantive question as search context in the
running worker; source records are retrieved afresh, never cached. That search
hint resets when the worker restarts. Conversation history still resumes through
Codex, and the model can use its tools when fresh evidence has gaps. The graph
itself has no additional durable transcript or checkpoint store. Hosted LangSmith
tracing remains disabled.

Verify the real MCP path with synthetic data, including corrections, disabled
search and assessment restrictions:

```sh
node --import tsx tests/integrations/answer-evidence.mjs
# Explicit live comparison using your signed-in Codex allowance:
node --import tsx tests/integrations/answer-evidence.mjs --live
```

Live reports stay ignored under `private/answer-evals/<timestamp>/`. They preserve
before/after answers, first-text and total latency, node timings and retrieved
evidence. This fixture uses deterministic vectors to check integration, not to
benchmark embedding quality. Before uses model-directed tools; after retrieves
before answering. Both use the same model and current teaching instructions.

## Adaptive coaching (LangGraph)

Click **Coach latest attempt** in the floating tutor, or **Coach this attempt**
on a completed-attempt screen. In either client, `/coach latest`, `/coach this`
(with an attempt screen), and `/coach Two Sum` select the target directly.
Ambiguous results prompt you to send `/coach` followed by an offered attempt ID.
The original exact “Coach me through my latest attempt” starter also works.
Other free-form requests stay in ordinary chat until coaching is active. Opening
the tutor alone does not start coaching. Ordinary explanations and goal/preference
requests use the evidence-first ordinary answer flow.

Python uses the explicit target, retrieves bounded evidence through MCP, and runs a
LangGraph teaching loop. It selects one focus, asks a diagnostic question, and
adapts to the answer with a clarification, hint, explanation, or wrap-up. You can
ask for a direct explanation at any point. Coaching observations are tentative;
they do not update scores, schedules, or Learning Insights diagnoses.

The graph owns teaching state. Codex calls use ephemeral threads and validated
structured output, with model tools disabled. Python gathers the selected attempt,
up to two earlier attempts on the same problem, current preferences and the
bounded learner snapshot. Learning Insights is supplementary and can be absent.
Once coaching is active, one structured call both interprets the message and
chooses the teaching response. Goal/preference requests and unrelated questions
hand back to ordinary chat, preserving the pending coaching question. Starting or
switching attempts resolves the supplied target directly; no model classifier is
used.
Pause and resume are direct state changes. An ambiguous attempt-switch request
during coaching prompts you to use the button or `/coach` command.

Routine follow-ups retrieve only fresh access status, the selected attempt and
current preferences. The model sees recent dialogue, the current focus and prior
hints. It can request one bounded expansion to broader learner history and
Learning Insights when a comparison needs them. Access is checked again before
committing a response. This reduces input and sequential model calls without
caching access permissions or preferences.

Structured coaching uses the configured model with low reasoning
effort to reduce the wait for short conversational turns. Ordinary chat keeps
its existing reasoning settings. `BLOOMCODE_COACHING_MODEL` optionally overrides
only the coaching model; close and reopen the tutor after changing the backend's
environment. Evaluation reports record both models and coaching effort. A faster
model is not necessarily an equally capable teacher; inspect the saved responses
before changing it. No priority service tier is enabled.

Activity appears while coaching runs; the answer appears after schema and
reference validation. General chat continues to stream tokens as before.

**Return to chat** pauses coaching; **Resume coaching** restores the last question.
After Stop, close/reopen the tutor and use **Retry step** if interrupted work remains.
A committed response is not regenerated on resume. An interrupted model call can
be repeated and incur more usage. Minimise/navigation preserve the current view;
reopening the worker restores the saved session. Terminal equivalents are
`/coach-pause`, `/coach-resume`, and `/coach-retry`.

State lives in `tutor/coaching.sqlite` with local pointer files beside existing
session storage, protected by the same process lock. New conversation clears the
active coaching pointer, preserving old checkpoints and authoritative goals and
preferences. Checkpoints are versioned and are **not included in study database
backups**. Unsupported state can be reset with New conversation. For a corrupt
SQLite file, close the tutor and move that file aside before reopening; do not
replace or delete BloomCode's study database. LangGraph is required for the
ordinary answer flow as well as coaching. A corrupt coaching checkpoint leaves
ordinary evidence-backed chat available. Hosted LangSmith tracing is disabled
by default.

The graph pauses between turns using a separate `interrupt()` node; resuming it
cannot replay a model call before the pause. Request receipts prevent duplicate
committed coaching turns. Evidence is refreshed on each coaching answer, and
changed attempt contents invalidate the previous question's assumptions. Access
checks run before retrieval and again before committing an answer. Active practice
blocks coaching, including in the terminal.

### Before/after evaluation

Run explicitly (uses your signed-in Codex allowance):

```sh
npm run eval:tutor
# All ten scenarios:
npm run eval:tutor -- --cases=all
```

The runner starts a disposable study database, seeds two synthetic attempts,
compares the original `chat_reply` with the LangGraph path using identical learner
messages, with an explicit coaching target for the LangGraph variant, and removes
the test database afterwards. It does not use your study workspace. Reports remain ignored under `private/coaching-evals/<timestamp>/`:

- `comparison.md`: side-by-side responses, timings, and space for your judgement.
- `comparison.json`: full responses, model-call metadata, available usage,
  evidence snapshots, unknown record-ID checks, and software errors.

The default three scenarios cover an incorrect answer, a correct answer, and an
explicit request for explanation. The ten author-reviewed scenario definitions
also cover ambiguous/missing records, sparse/conflicting evidence, style overrides,
unavailable insights, and unsupported execution claims. Preference persistence
and restart correctness remain deterministic integration/unit checks.

Score relevance, adaptation, hinting and evidence honesty separately. These are
single-run examples, not statistically reliable improvement claims. Scripted
answers may align more naturally with one version's question; inspect the whole
exchange. Fresh evidence retrieval and model generation add latency; routing uses
no model call. Quality scores are left blank for human review, and software
failures are reported separately.
