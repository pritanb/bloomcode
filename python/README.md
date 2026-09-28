# Python tutor

Bloom is BloomCode's AI tutor. **Python manages sessions and teaching behavior,
LangGraph coordinates the workflows, and Codex generates answers.** Platform data
comes through the existing [TypeScript MCP server](../src/integrations/mcp.ts);
Fastify and SQLite remain responsible for authoritative study data.

[Architecture diagrams](../docs/architecture/README.md#bloom-ai-tutor)

## Setup and run

Requires Python 3.11+, the project's Node.js version, a running BloomCode backend,
and file-based Codex sign-in (`CODEX_HOME/auth.json`, normally `~/.codex/auth.json`).
Keyring-only sign-in is not supported. Selected study context is sent to Codex
and uses the signed-in account's allowance.

Run from the repository root:

```sh
npm ci
python3 -m venv python/.venv
python/.venv/bin/python -m pip install -r python/requirements.txt
```

**In the app:** build with `npm run build`, restart the backend, and click
**Ask Bloom**; the tutor connects and resumes automatically. For desktop development, use `npm run electron:dev`; it sets
`BLOOMCODE_TUTOR_ROOT` so the staged app can find this worktree's Python files.
Set `BLOOMCODE_PYTHON` to an absolute interpreter path if using another environment.
Python is not yet bundled in the desktop release.

**In the terminal:**

```sh
python/.venv/bin/python python/chat.py \
  --api-url http://127.0.0.1:4317 \
  --token-file /absolute/path/to/data/api-token
```

The token file lives beside the backend's database. Use `--new` for a fresh
conversation, `--model MODEL` to override the model, and `/quit` to exit.
Without a token file, chat runs without platform context or tools.

## Code map

```text
python/
├── chat.py                 # Terminal entry point
├── worker.py               # JSON-lines bridge for the app
├── tutor/
│   ├── session.py          # Codex session, instructions and proposals
│   ├── answer_graph.py     # Ordinary answer workflow
│   ├── learner_state.py    # MCP client and learner snapshot
│   ├── goal_progress.py    # Deterministic progress calculations
│   ├── session_lock.py     # Prevent concurrent session writers
│   └── coaching/
│       ├── controller.py   # Coaching commands and chat handoffs
│       ├── graph.py        # Persistent teaching loop
│       ├── evidence.py     # Retrieve and compact study records
│       └── model.py        # Structured Codex responses and validation
├── tests/                  # Offline unit tests
├── evals/                  # Live comparisons, scenarios and resume check
└── requirements.txt
```

Start at `chat.py` or `worker.py`, then follow `tutor/session.py` into either flow:

- **Ordinary chat:** `snapshot → retrieve → answer`. Load recent attempts, scores,
  goals and preferences; retrieve observations using existing semantic/keyword
  search; check source excerpts and include counterexamples. Pass bounded evidence
  to Codex, which maintains conversation history and can call allowed MCP tools.
  Unavailable evidence is reported as a limitation. No classifier model call.
- **Coaching:** start with a coaching button or `/coach latest` (also accepts a
  problem name). LangGraph gathers evidence, asks a diagnostic question, waits,
  and adapts the next hint or explanation. Python retrieves evidence; coaching
  model tools are disabled. Responses appear after structured-output validation.
  `/coach-pause`, `/coach-resume`, and `/coach-retry` control the saved flow.

Fastify starts `worker.py` on demand and exchanges versioned JSON-lines messages.
The UI polls every 500 ms for activity and incremental chat text. Stop cancels a
request; in-app requests time out after three minutes.

## State and boundaries

- Goals and preferences require explicit confirmation before backend writes.
  The model uses restricted tools and cannot directly change scores or schedules.
- Active practice blocks tutor access and stops an in-flight app response.
- Completed conversations resume automatically. One process can use a session
  directory at a time; quit BloomCode before using that session in the terminal.
- Tutor files live in `tutor/` beside the API token, or `private/tutor/` without one
  (`--state-dir` overrides this). Codex history lives in `codex-home/`; coaching
  checkpoints live in `coaching.sqlite`. The ordinary answer graph has no checkpoints.
- Study-database backups include saved goals/preferences, **not tutor conversation
  files or coaching checkpoints**. Unconfirmed proposals and interrupted answers
  are not restored when the worker closes.

## Verify

Run offline tests and real MCP checks against disposable databases:

```sh
python/.venv/bin/python -m unittest discover -s python/tests -t python -p 'test_*.py'
node --import tsx tests/integrations/python-context.mjs
node --import tsx tests/integrations/answer-evidence.mjs
```

Live checks are opt-in and consume Codex allowance:

```sh
npm run eval:tutor                                           # Coaching comparison
node --import tsx tests/integrations/answer-evidence.mjs --live # Answer comparison
python/.venv/bin/python python/evals/check_resume.py           # Restart/resume check
```

Comparisons save responses, timings and evidence under ignored
`private/coaching-evals/` or `private/answer-evals/`. Review answer quality manually;
these small scenarios do not establish a measured quality improvement.
