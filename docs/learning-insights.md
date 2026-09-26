# Learning Insights

Learning Insights connects evidence across completed attempts. It is optional: saving,
scoring, and scheduling continue to work without a model or a connected tutor.

Open **Learning insights** and choose **Enable learning insights**. The app downloads
one pinned embedding model from Hugging Face, analyzes all completed history newest
first, and picks up new attempts and changed reflections automatically. The initial
backfill is batched; reports refresh after every ten analyzed attempts and when the
queue drains. **Pause analysis** retains the last report. **Retry analysis** retries
failed jobs or a failed model download.

Automatic analysis runs through the app's Codex worker (**Settings → AI tutor**).
Immediate attempt reviews take priority. With the tutor off or paused, pending
analysis remains durable and resumes later.

## Pipeline

1. The tutor extracts up to eight short observations per completed attempt. Each
   observation has a source field, exact supporting excerpt, polarity, and evidence
   type. Invalid quotes and source/type mismatches are rejected. An empty result is
   valid for sparse records.
2. A worker thread runs `Xenova/all-MiniLM-L6-v2` using Transformers.js 4.3.0, CPU,
   q8 ONNX weights, revision `751bff37182d3f1213fa05d7196b954e230abad9`. The conversion
   is the local runtime representation of `sentence-transformers/all-MiniLM-L6-v2`.
   Token-aware recursive splitting keeps every piece within 256 tokens, then averages
   and normalizes the piece vectors into a 384-dimensional observation embedding.
3. SQLite caches vectors by observation fingerprint and model identity. Exact cosine
   similarity and keyword overlap are combined with reciprocal rank fusion (k=60).
   No vector service is needed. The report retrieves neighbours of recent difficulty
   and strength observations, explicitly seeking contrary evidence and previous
   attempts on the same problem. Retrieval covers the full indexed history, but the
   bounded report context is not an exhaustive analysis of every possible pattern.
4. The tutor produces a structured report. The backend validates all citations and
   catalogue IDs. Recurrence requires difficulties on two distinct problems.
   Improvement requires an earlier difficulty and later strength on the same problem,
   with matching language, help and evidence conditions. These are conservative
   evidence gates, not proof of a causal learning effect.
5. Question candidates are ranked using available catalogue metadata and keyword
   overlap with retrieved focus areas. Exact constraints are not available for every
   question. Suggestions remain optional targeted practice and do not update plans.

An observation can be dismissed with a reason. Future synthesis excludes it, and
reanalysis receives the correction. The same source-field/excerpt pair is suppressed
even if the tutor paraphrases its summary. Findings citing invalidated observations
are removed immediately from the displayed previous report. Corrections cannot
mechanically prevent every semantically equivalent claim using a different excerpt;
the prompt also instructs the tutor to respect their meaning.

## Data, privacy, and reliability

Embedding inference runs on your computer; texts are not sent to an embedding API.
Model files are cached beside the database in `embedding-models/`. Initial model
retrieval needs internet access. Tutor extraction and synthesis send selected saved
code, reflections, metadata, corrections and evidence to OpenAI through the Codex
CLI. Local embeddings do not make tutor generation local.

`insight_jobs`, `insight_observations`, `insight_corrections` and `insight_reports`
hold jobs, observations, dismissals and report snapshots; `settings.insightsEnabled`
records whether analysis is on. `insight_embeddings` is a rebuildable cache.
Attempt-analysis claims expire after four minutes and report claims after ten; stale
fingerprints and superseded claims cannot commit results. Processing
is sequential with bounded context and no automatic retry loop for failed model
responses. Source fingerprints, model identity when returned, analysis/prompt
version, timings, retrieved IDs and errors support diagnosis. Raw model traces
are not written to log files.

Learning records live in the database, so SQLite backups include them. Running claims
are reset when the app starts; embeddings are rebuilt, and model files are not part of
the database.

While a mixed assessment is active, insight content and retrieval are hidden and
analysis results cannot commit. Displaying a suggested question records pattern
exposure through the existing catalogue mechanism. Background candidate selection
alone does not mark questions exposed.

Authenticated browser endpoints under `/api/insights` provide status, enable/pause,
retry and dismissal. A bearer-only endpoint provides evidence retrieval. The MCP tools
`get_learning_insights` and `retrieve_learning_evidence` let a chat tutor read the
report and search observations. Only the app's Codex worker runs analysis, calling the
service in-process. Analysis has no score or schedule mutation capability.

## Evaluation

`npm run eval:insights -- evals/learning-insights-results.json` checks retrieval against
`evals/learning-insights.json`. It does not read your study database. Model files are
cached in the temporary directory, or in `INSIGHTS_EVAL_CACHE` if set.

The fixture has 83 synthetic attempt observations and 34 queries across arrays, two
pointers, sliding window, stacks, binary search, linked lists, trees, heaps,
backtracking, graphs, dynamic programming, intervals, bits, tries and interview habits. Each query has two or three relevant observations. Hard negatives include the
same pattern with a different mistake, and off-topic notes that share a keyword ("stack
of flashcards", "binary installer"). The author wrote the observations, queries and
labels while able to see all of them, so this is a regression check, not an independent
benchmark.

Run on an M1 Pro with 16 GB, 2026-09-26:

| Mode              | Recall@5 | nDCG@5 | Queries with every relevant item in top 5 |
| ----------------- | -------- | ------ | ----------------------------------------- |
| Keyword           | 0.691    | 0.619  | 16 of 34                                  |
| MiniLM semantic   | 0.824    | 0.806  | 21 of 34                                  |
| Hybrid (RRF k=60) | 0.804    | 0.777  | 21 of 34                                  |

The first embedding batch took 7.7 s including model start-up with cached files. The warm
query batch took 2.5 ms per query. The process used 259 MiB resident memory at the end
of the run. Semantic retrieval scored slightly above hybrid here. The hybrid settings
were not tuned on this fixture. These numbers say nothing about learning gains or report
quality.

For human report review, record each finding alongside its cited attempts and judge:

- Does every factual claim follow from the quoted evidence?
- Is self-report clearly separated from code inference and recorded outcomes?
- Does the finding account for strengths and contrary evidence?
- Are recurrence and improvement claims justified by distinct/comparable attempts?
- Does the suggested habit address the issue, and is question relevance supported
  by supplied metadata rather than invented requirements?

Keep accepted and rejected cases, the model/prompt version, and reviewer decisions.
Backend tests cover fabricated citations, invalid quotes, recurrence gates, correction
suppression, stale claims, restart recovery, and disclosure protections. A test runs the
app's Codex worker against a deterministic stand-in executable to verify orchestration
and review priority; it verifies plumbing, not the quality of the model.

`npm run demo` includes a clearly labeled synthetic learning report with inspectable
sources and correction controls. It uses its own disposable database and no AI calls
until explicitly enabled.

## Desktop packaging

Native `@img` and `onnxruntime-node` libraries are explicitly unpacked from ASAR so
the desktop app can load the local MiniLM worker.

### Concise report contract

New reports use three presentation fields: Habit (`title`, at most 6 whitespace-separated words), Next time (`action`, at most 25 words), and Why (`explanation`, at most 35 words). The prompt requires one concrete action starting with a verb and familiar language. Evidence references and uncertainty remain available in the detail panel. Length and reference validation are enforced; plain language and usefulness still require qualitative evaluation.

The worker makes at most one correction request for malformed JSON, schema violations, or rejected evidence. It includes the validation errors and shares one time budget across both model calls. Timeout, disconnect, and stale-claim failures do not trigger a correction call. Failed correction retains the previous report and exposes retry. Reports saved in the older format stay valid; new submissions must satisfy the concise contract. Report-format versioning refreshes synthesis without re-extracting attempts or rebuilding embeddings.

### Topic priorities

“Where to focus” is independent of Learning Insights. One model request includes all topics, saved scores, the 4/5 readiness target, and the last 28 days of completed attempts and score movements (up to 20 of each per topic). The AI weighs personal readiness against typical FAANG coding interview relevance and selects three topics in priority order. With fewer than three topics, it selects those available. Reasons over the word limit are rejected along with the whole selection.

The card shows each selected topic with a one-sentence reason (at most 30 words) grounded in the supplied scores and attempts. Selections saved before reasons existed show links only until the next refresh. Recommendations are generated only when you press **Generate recommendations** or **Refresh**; nothing refreshes on a schedule. The previous selection stays visible while refreshing or while the tutor is off. Score changes do not trigger extra requests. Failed generations keep the last selection and can be retried manually; there is no automatic model correction request.

Topic analysis has separate enable/retry endpoints, job state and saved report. It does not require learning reports or embeddings and never changes scores or study schedules. Older reports remain importable and are replaced on the next topic analysis.
