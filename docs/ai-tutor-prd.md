# BloomCode personal AI tutor

Status: Draft for discussion, not an implementation commitment  
Date: 27 September 2026  
Audience: Product and engineering  
Scope: Single-user, local-first desktop application

## 1. Product intent

Build a persistent DSA tutor that understands the learner's practice history, investigates difficulties, asks diagnostic questions, recommends relevant practice, and follows up on agreed learning objectives across sessions.

The learner should experience one continuing teaching relationship across the dashboard, topics and completed attempts. The tutor should explain which evidence informed its advice and let the learner correct its understanding.

Python will implement the tutor's context, memory and teaching services. Codex will provide the model-driven conversation and tool-selection loop. BloomCode's existing TypeScript backend will retain authority over application data and study rules.

## 2. Problem and current foundation

BloomCode currently offers automatic attempt feedback, Learning Insights and topic recommendations. These features use selected study context but do not provide a shared, persistent conversation with explicit learning objectives and follow-up.

Useful foundations already exist:

- Saved code, notes, outcomes, help levels, confidence, solve times and reflections.
- Topic scores, review schedules, stable daily plans and pattern-exposure safeguards.
- Evidence observations, local embeddings, retrieval, corrections and citation validation.
- An authenticated local API and an MCP adapter with versioned, duplicate-safe mutations.
- An isolated Codex CLI runner for automatic reports.

The automatic runner currently uses ephemeral sessions and disables tools. The conversational tutor needs a separate integration with session continuity and a restricted tool set.

## 3. Goals and boundaries

### MVP goals

1. Explain a practice recommendation using current, accessible study evidence.
2. Discuss a completed attempt in relation to earlier attempts and stated goals.
3. Ask a useful diagnostic question when the available evidence does not justify a diagnosis.
4. Remember learner-confirmed preferences and objectives across conversations and restarts.
5. Revise inferred learning difficulties when the learner corrects them or new evidence conflicts.
6. Keep normal practice, saving and scheduling usable when the tutor is unavailable.

### Deferred capabilities

- Proactive session briefings and automatic follow-ups after attempts.
- Tutor interaction during active practice, including graduated hints and exposure accounting.
- Executing submitted code, voice tutoring and model fine-tuning.
- Multi-agent collaboration, a knowledge-graph database and a dedicated vector service.
- Automatic score changes or autonomous rescheduling by the new tutor.
- Shared/cloud accounts and continuous monitoring while the desktop app is closed.

The MVP uses existing observations and embeddings where available. A learner must still be able to chat from structured study history when Learning Insights is disabled or embeddings are unavailable.

## 4. First user experience

### Journey A: Decide what to practise

1. The learner opens the tutor from the dashboard and asks what to practise today.
2. The tutor receives a compact overview and retrieves any additional evidence it needs.
3. It proposes a focus, cites the relevant completed attempts and acknowledges limited or contradictory evidence.
4. The learner discusses the recommendation and explicitly agrees on a learning objective.
5. BloomCode saves the objective without changing the daily plan or review schedule.
6. After restarting the app, the learner can resume the conversation and see the objective.

### Journey B: Investigate a recurring difficulty

The learner opens the tutor from a completed binary-search attempt. The tutor compares relevant attempts, separates reported uncertainty from code observations, and asks the learner to explain a boundary update. It uses the answer to suggest a concrete exercise or habit. Claims of recurrence require evidence across distinct problems under the existing insight rules.

### Journey C: Correct the tutor

The learner rejects a diagnosis, explaining that a note described a hypothetical mistake. BloomCode marks the hypothesis as corrected, excludes it from current memory, and prevents subsequent recommendations from treating it as established evidence. The original conversation can remain readable as history, with the correction visible.

## 5. Functional requirements

| ID  | Requirement             | Acceptance criterion                                                                                                                                                      |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Persistent conversation | Messages and turn status survive restart. A session can resume or recover from application-owned history if its Codex session is unavailable.                             |
| F2  | Contextual entry points | Dashboard, topic and completed-attempt entry points supply the intended scope. The tutor does not assume the learner opened a different problem.                          |
| F3  | Evidence-based answers  | Factual statements about the learner link to valid source records. Counts, dates and scores come from backend queries. Sparse history produces uncertainty or a question. |
| F4  | Selective tool use      | The tutor can request attempt comparisons, topic history, current objectives and relevant observations within a per-turn limit.                                           |
| F5  | Durable learner memory  | Preferences, objectives and hypotheses are distinct records. Inferred records include provenance and can be corrected.                                                    |
| F6  | Objective follow-up     | A later conversation can retrieve an agreed objective and inspect subsequent evidence before claiming progress.                                                           |
| F7  | Stream and cancel       | The UI streams responses, exposes cancellation and distinguishes completed, interrupted and failed turns. Partial outputs cannot commit memory changes.                   |
| F8  | Availability            | Sign-in errors, usage limits or Python failures produce a recoverable tutor state. Existing study workflows remain usable.                                                |
| F9  | Assessment protection   | Tutor access is unavailable during active practice in the MVP. Mixed-assessment restrictions also apply to tool calls, restored transcripts and late results.             |
| F10 | Backup and recovery     | Portable conversations, objectives and memory are included in the SQLite backup. Restoring a backup does not require old Codex session files to continue tutoring.        |

Personalisation does not authorise inventing problem constraints, test results, interview-frequency statistics or psychological diagnoses. A long solve time alone does not establish a misconception.

## 6. What we build in Python

These are proposed components, not existing modules.

| Component                | Concrete Python work                                                                                                                                                                     | Product outcome                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Codex session adapter    | Use the official SDK; manage conversations, streamed events, cancellation, bounded retries and session identifiers.                                                                      | A continuing conversation with recoverable failures.             |
| Context builder          | Combine current scope, learner-confirmed goals, structured history and selected memories within explicit size budgets. Deduplicate evidence and preserve source IDs.                     | Relevant context without sending the entire workspace each turn. |
| Tutor tool service       | Expose typed, narrowly scoped MCP tools backed by the authenticated Fastify API. Validate inputs and bound result sizes.                                                                 | The tutor can investigate rather than rely on one fixed prompt.  |
| Learner-memory service   | Propose structured preferences, objectives and evidence-backed hypotheses; reconcile corrections, supersession and stale sources. Submit proposals to Fastify for validated persistence. | Learning continuity across conversations.                        |
| Teaching policy          | Implement context-sensitive instructions and deterministic controls for diagnosis, clarification, explanation, practice selection and follow-up.                                         | Consistent teaching behaviour with appropriate uncertainty.      |
| Retrieval and comparison | Reuse existing search initially, add structured attempt comparisons, then evaluate Python reranking if beneficial.                                                                       | Advice that accounts for earlier and contrary evidence.          |
| Evaluation package       | Run labelled scenarios, inspect tool traces, measure evidence use, unsupported claims, correction handling and latency.                                                                  | Demonstrable quality improvements and reproducible experiments.  |

Suggested package structure:

```text
ai/
  pyproject.toml
  src/bloomcode_tutor/
    worker.py
    codex_adapter.py
    context.py
    tools.py
    memory.py
    teaching.py
    contracts.py
    evaluation/
  tests/
  evals/
```

Use the official `openai-codex` SDK, typed Python contracts and a small test/evaluation stack. Framework and dependency versions must be pinned during the compatibility prototype. LangGraph is deferred: Codex already owns the agent loop, and a second orchestration framework needs a demonstrated workflow requirement.

This is substantive Python engineering even without training a model: context selection, evidence provenance, memory lifecycle, agent integration, failure recovery and evaluation are application responsibilities.

## 7. Architecture and ownership

```text
React tutor panel
       | authenticated chat requests / streamed responses
Fastify tutor routes and persistence
       | versioned local messages
Python tutor worker
       | official Python SDK
Local Codex runtime
       | restricted MCP tool calls
Python tutor tool service
       | authenticated, scoped application API
Fastify domain services -> SQLite
```

For the prototype, prefer a managed Python subprocess with a versioned JSON message protocol. Avoid adding another public HTTP server. The Python MCP tool service may run as a separate child process; it must not depend on shared in-memory state with the worker.

Fastify owns all authoritative writes, authentication, assessment restrictions, exposure tracking, scores, schedules and backup behaviour. Python reads through application APIs and proposes memory or objective updates; it never opens the study database directly.

The existing TypeScript MCP adapter remains available to external tutors. Reuse its backend domain services rather than duplicating scoring or disclosure logic in Python. The new tutor receives only its intended tools, not every mutation exposed to external clients.

A tutor-specific capability or scoped credential must enforce permitted operations at the backend boundary. An MCP allowlist and a read-only filesystem sandbox do not by themselves prevent application writes.

## 8. Context and memory contract

### Context supplied at turn start

- Current page scope and tutoring mode.
- Learner-confirmed goals, preferences and outstanding objectives.
- Compact, current study overview with exact backend-computed values.
- Recent conversation context plus selected relevant evidence.
- Coverage limitations and any corrections affecting selected evidence.

### Proposed portable records

- **Conversation:** application ID, scope, timestamps and optional Codex session reference.
- **Message/turn:** role, content, completion state, source references and stable request ID.
- **Learner preference:** value, source message and confirmation state.
- **Learning objective:** description, status, agreed-at timestamp and related topic/evidence IDs.
- **Learning hypothesis:** claim, evidence references, uncertainty, source versions, created/reviewed dates and active/corrected/superseded state.
- **Tutor run:** model, prompt/contract versions, timing, tool outcomes, errors and available usage.

Exact tables and migrations belong in the implementation design. Keep durable learning records in BloomCode's database; store machine-specific credentials and runtime configuration separately. Codex session files are a resumability aid, not the only copy of product memory.

When source records change, corrections occur or data is removed, invalidate dependent hypotheses and refresh context before the next answer. Where a resumed Codex conversation contains invalidated material, start a replacement session from application-owned, corrected context. Old assertions must not silently return through session history.

Existing Learning Insights observations remain source evidence. The new memory layer should reference them rather than independently recreating their diagnoses and correction rules.

## 9. Tools and interaction events

Initial tools should cover learner overview, topic history, completed-attempt context, attempt comparison, observation retrieval and current objectives. Objective and preference writes require explicit learner intent and the usual version/idempotency checks. Model-inferred memory is visibly labelled as a hypothesis.

Candidate discovery should use bounded metadata. Showing a suggested question must follow BloomCode's existing pattern-exposure rules. A backend read that records exposure is not side-effect-free; new tutor APIs must distinguish internal candidate selection from learner-visible disclosure.

For the MVP, reuse collected study data and record the new conversation/objective interactions. Later instrumentation can add explicit hint requests, recommendation acceptance and diagnostic-question responses. Do not infer detailed learning behaviour from clicks or idle time that the application does not actually measure.

## 10. Runtime, privacy and reliability

- Use Codex-managed authentication. ChatGPT sign-in uses applicable subscription limits; API-key access remains a separate option.
- Disclose that selected study context and tutor messages go to the model provider. Local storage does not imply local model inference.
- Use an app-controlled tool/configuration scope without changing the user's global MCP configuration or loading unrelated personal tools.
- Keep generic shell/browser access disabled unless a later requirement justifies it; tutor data access goes through the scoped tools.
- One active turn per conversation in the MVP. Apply explicit time, tool-call and output-size limits; select numerical budgets after prototype measurements.
- Persist request identity before work starts. Interrupted turns cannot duplicate messages, agreed objectives or memory writes on retry.
- Revalidate permissions and source versions before committing a result. On entering active practice, cancel tutor work and suppress late output; mixed-assessment checks remain enforced server-side.
- Persist useful run metadata by default, with detailed content tracing opt-in and local. Do not log credentials.
- The desktop app owns Python/runtime startup, health checks and shutdown. Packaging the chosen runtime is an MVP release requirement.

## 11. Delivery stages and acceptance gates

| Stage                       | Deliverable                                                            | Gate                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Compatibility prototype  | Python SDK + restricted MCP tool + disposable data                     | Two conversational turns use evidence; restart/resume and cancellation work; unrelated tools stay unavailable; authentication and version compatibility are established. |
| 1. Useful conversation      | Tutor panel, context API, streaming, citations and persistence         | The learner can discuss a completed attempt or practice recommendation and resume after restart.                                                                         |
| 2. Learning continuity      | Preferences, agreed objectives, hypotheses and corrections             | A later conversation recalls an objective; corrected/stale evidence does not reappear as accepted memory.                                                                |
| 3. Reliable desktop release | Packaging, backup recovery, limits and evaluation                      | Python failures preserve study workflows; backup recovery works without old Codex sessions; critical access and persistence checks pass.                                 |
| Later. Proactive teaching   | Post-attempt follow-ups, session briefings and optional practice hints | Add only after the conversational tutor demonstrates useful, evidence-grounded behaviour.                                                                                |

## 12. Validation and success measures

Follow [testing.md](testing.md). Use disposable databases and focused critical tests. Do not run model experiments against the real workspace, create cosmetic test matrices or add repetitive review cycles.

Required deterministic checks:

- Duplicate-safe conversation/objective writes and interruption recovery.
- Memory invalidation, correction handling and source-reference validation.
- Scoped tool access, assessment restrictions and exposure accounting.
- Backup recovery, including a missing Codex session.
- One tutor browser journey: ask, inspect evidence, agree on an objective, reload and resume.

Create an initial evaluation set of approximately 20–30 reviewed scenarios covering sparse history, competing evidence, recurring difficulties, claimed improvement, corrections and uncertain recommendations. This is a proposed regression set, not evidence of general learning effectiveness.

Record evidence correctness, unsupported learner claims, usefulness of the next teaching action, appropriate questions/abstention, tool selection, turn latency and available usage. Establish a baseline before setting numerical quality/latency release thresholds. Invalid source IDs and forbidden study mutations must be rejected independently of model quality.

The defining product acceptance scenario is: “What should I practise today?” leads to a sourced discussion, an explicitly agreed objective and a useful continuation after an app restart. Longer-term learning improvement requires longitudinal evidence and is not an MVP claim.

## 13. Assumptions and unresolved decisions

- The MVP is on-demand and uses dashboard/topic/completed-attempt context. Active-practice coaching is deferred.
- Existing automatic reports remain operational; they do not share one giant Codex conversation with the tutor.
- The official Python SDK is the preferred integration, subject to the compatibility gate. Some app-server features are experimental; avoid relying on experimental dynamic tools when MCP meets the requirement.
- Choose the SDK's pinned runtime versus the app-bundled CLI after testing. The existing bundled executable was an alpha build when inspected.
- Confirm the desired retention controls for conversations and memories before implementing deletion and export UI. Deleting application records must also invalidate resumed model context; old backups have their own retention lifecycle.
- Set model/effort defaults and per-turn budgets from measured quality and latency, not assumed framework performance.

## 14. References

Repository: [tutor integration](tutor-integration.md), [Learning Insights](learning-insights.md), [backend conventions](../src/server/README.md), [Codex runner](../src/server/tutor/codex.ts), [existing MCP tools](../src/integrations/mcp.ts).

Official documentation checked on 27 September 2026:

- [Codex Python SDK](https://learn.chatgpt.com/docs/codex-sdk): local Python SDK and its pinned CLI dependency.
- [Codex app server](https://learn.chatgpt.com/docs/app-server): conversations, streamed events, authentication and integration lifecycle.
- [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): server configuration and tool allowlists.
- [Codex authentication](https://learn.chatgpt.com/docs/auth): ChatGPT sign-in and API-key access.

Framework support does not establish that BloomCode's complete integration works; Stage 0 verifies that before product implementation.
