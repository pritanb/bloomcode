# Python AI workflows

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
The desktop preview includes these Python sources. Install its interpreter and dependencies with the [desktop AI setup](../docs/desktop.md#optional-ai-setup-for-the-v030-preview).

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
├── ai_worker.py            # Task dispatch for background LLM work
├── insights_worker.py      # Report graph and host validation protocol
├── reviews/                # Attempt feedback
├── recommendations/        # Topic priorities
├── ai_core/                # Shared runtime, model, evidence and protocol
├── insights/               # Targeted Learning Insights graph
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

- Bloom plans each day in the background (`recommendations/plan.py`): its picks
  become the plan. In chat, goals, preferences and plan changes require explicit
  confirmation before backend writes. The model uses restricted tools and cannot
  directly change scores or schedules.
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

## Shared AI layer and Learning Insights

`ai_core/` contains the isolated Codex runtime, structured model calls, streaming,
source verification and worker protocol. `tutor/` owns conversation and coaching
policy; `insights/` owns targeted report policy. Both use the same SDK infrastructure.

Fastify starts `insights_worker.py` for a claimed report job. Its LangGraph flow is
`select → inspect → generate → validate`. The worker requests supporting attempts
through the parent, which restricts reads to the current job's evidence. It inspects
at most twelve attempts and 48,000 source characters. Similarity retrieval groups current observations across the full history into candidate patterns,
ranked by distinct-problem support. Each candidate keeps an anchor, related cross-problem
support and contrary evidence together. Python admits complete candidate bundles within
the inspection budget, then uses spare capacity for related neighbours. It never selects
attempts by recency or time sampling. Stale or omitted core evidence removes the candidate
and is recorded as a limitation. Similarity is a hypothesis, not proof of a shared difficulty.
The deterministic grouping threshold is a retrieval heuristic that still needs quality evaluation.
Fastify validates citations,
recurrence, corrections and current access before saving. There is normally one
model call and at most one correction across all validation stages.

Reports use Settings' model and report reasoning effort. They require the same
Python dependencies and file-based sign-in as Bloom, but use temporary isolated
sessions without Bloom's conversation lock. Missing setup fails the report clearly;
saved reports remain readable. Attempt extraction, attempt reviews, topic picks and the connection test also
run through Python. Fastify sends task data, never model prompts. The desktop release includes workflow sources; the Python interpreter and dependencies are installed separately.

New reports include up to six distinct habits, each with a specific action, exercise and success check. Source verification
checks provenance, not whether a diagnosis is correct. Sparse evidence can produce
no findings. Reports are included in native SQLite backups; temporary AI sessions
and credentials are not added to those backups. Older reports remain readable.

Compare legacy and targeted reports using synthetic records only:

```sh
npm run eval:insights:reports                    # list scenarios; no model calls
npm run eval:insights:reports -- --live          # explicit Codex usage
```

Use `--model`, `--effort`, or `--scenario` to narrow a comparison. Results and timing
are saved to ignored `private/insights-comparison/`. Review `comparison.md` for
specificity, supporting evidence, exercise relevance and a useful success check;
a valid response is not automatically a better one. The legacy prompt exists only
in the evaluation harness and is not a production fallback.

## Responsibility boundary

All application LLM behavior lives here: prompts, Codex calls, response schemas,
feedback formatting, conversation policy and LangGraph workflows. The ordinary
background tasks in `reviews/`, `insights/extract.py` and `recommendations/` use one
structured model call; they do not need a graph. Fastify owns queue priority,
deadlines, permissions, validation against authoritative records, and persistence.
The shared TypeScript process bridge only transports requests and results.

Local embedding inference, vector storage and ranking remain retrieval infrastructure
in the backend. They do not use an LLM. The retired TypeScript inference runner has
been removed; its remaining `codex.ts` module only discovers the executable/version
and defines the host error type.
