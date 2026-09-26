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
code, reflections, metadata, corrections and evidence through your connected MCP
client's model provider. Local embeddings do not make tutor generation local.

`learning_insights` holds durable state, jobs, observations, corrections and report
snapshots. `insight_embeddings` is a rebuildable cache. Job claims expire after four
minutes; stale fingerprints and superseded claims cannot commit results. Processing
is sequential with bounded context and no automatic retry loop for failed model
responses. Source fingerprints, model identity when returned, analysis/prompt
version, timings, retrieved IDs and errors support diagnosis. Raw model traces
are not written to log files.

Learning records live in the database, so SQLite backups include them. Running claims
are reset when the app starts; embeddings are rebuilt, and model files are not part of
the database. Existing study records,
score rules and Hermes/Sheet configuration are unchanged.

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

Run `npm run eval:insights -- evals/learning-insights-results.json` to compare retrieval
on the synthetic fixture. Downloads are cached in the temporary directory by default;
set `INSIGHTS_EVAL_CACHE` to use another evaluation-only cache directory. This script
does not read your personal study database.

The initial M1 Pro / 16 GB run used 17 indexed observations and six queries:

- Keyword: recall@5 0.750; nDCG@5 0.741.
- MiniLM semantic: recall@5 1.000; nDCG@5 0.961.
- Hybrid: recall@5 0.889; nDCG@5 0.901.
- First embedding batch in a fresh process with cached model files: 3.43 seconds.
- Warm query batch: 9.60 ms total; 1.60 ms per query averaged over six queries.
- Process resident memory at measurement: 304.14 MiB, including the worker; this is
  a point-in-time process measurement, not model-only memory or a peak measurement.

These are measurements on a tiny implementation-authored synthetic set, **not an
independently human-labeled benchmark**. Semantic retrieval outperformed hybrid on
this set; the hybrid result is reported rather than selectively omitted. The initial
hybrid configuration remains fixed to avoid tuning on six evaluation examples.
Before making portfolio accuracy claims, review the relevance judgments in
`evals/learning-insights.json`, add held-out examples and rerun. No learning-gain,
production accuracy or real-provider report-quality claim is established here.

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

## Implementation verification

Verified on the development M1 Pro using disposable databases: 110 critical tests,
the three existing browser checks (including practice/save/reload), TypeScript
checking, lint, production build, and manual report/evidence/dismissal inspection.
The final bearer-credential hardening also passed the 12 relevant backend/MCP tests.
The Apple silicon desktop package was launched with an isolated profile and its
local MiniLM worker loaded successfully. Native `@img` and `onnxruntime-node`
libraries are explicitly unpacked from ASAR for desktop loading.

### Concise report contract

New reports use three presentation fields: Habit (`title`, at most 6 whitespace-separated words), Next time (`action`, at most 25 words), and Why (`explanation`, at most 35 words). The prompt requires one concrete action starting with a verb and familiar language. Evidence references and uncertainty remain available in the detail panel. Length and reference validation are enforced; plain language and usefulness still require qualitative evaluation.

The worker makes at most one correction request for malformed JSON, schema violations, or rejected evidence. It includes the validation errors and shares one time budget across both model calls. Timeout, disconnect, and stale-claim failures do not trigger a correction call. Failed correction retains the previous report and exposes retry. Reports saved in the older format stay valid; new submissions must satisfy the concise contract. Report-format versioning refreshes synthesis without re-extracting attempts or rebuilding embeddings.

### Topic priorities

“Where to focus” is independent of Learning Insights. One model request includes all topics, saved scores, the 4/5 readiness target, and the last 28 days of completed attempts and score movements (up to 20 of each per topic). The AI weighs personal readiness against typical FAANG coding interview relevance and selects three topics in priority order. With fewer than three topics, it selects those available. Reasons over the word limit are rejected along with the whole selection.

The card shows each selected topic with a one-sentence reason (at most 30 words) grounded in the supplied scores and attempts. Selections saved before reasons existed show links only until the next refresh. Recommendations are generated only when you press **Generate recommendations** or **Refresh**; nothing refreshes on a schedule. The previous selection stays visible while refreshing or while the tutor is off. Score changes do not trigger extra requests. Failed generations keep the last selection and can be retried manually; there is no automatic model correction request.

Topic analysis has separate enable/retry endpoints, job state and saved report. It does not require learning reports or embeddings and never changes scores or study schedules. Older reports remain importable and are replaced on the next topic analysis.
