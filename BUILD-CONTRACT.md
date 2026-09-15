# Build coordination and API contract

The user approved implementation using the revised technical design and original Vite/React/Fastify stack. Build a real personal-use app, not mock screens. Authoritative specs are copied in docs/. Dashboard and existing topic scoring are REQUIRED. Live Google Sheet/tutor configuration must NOT be modified or cut over. An isolated read-only import is allowed. No fake study data in production; empty state until real import.

## Working rules

Use strict vertical TDD: test one behaviour, observe its failure, implement, run green. Keep tests real (temporary SQLite / Fastify inject for backend). All child work is in the shared repository with DISJOINT ownership. Do not git commit/stash/reset or change package.json/package-lock/config/shared types: parent owns integration and commits. Do not install dependencies concurrently. Record verification commands/results in your final handoff, along with missing items honestly. Use AU/UK English.

Ownership:
- Backend child: src/server/**, tests/backend/**, drizzle/**. May READ shared types, must not modify them without reporting a needed change.
- Frontend child: src/web/**, index.html, tests/web/**. Uses API below.
- Integrations child: src/integrations/**, scripts/**, tests/integrations/**, docs/operations.md, docs/migration.md. Parent owns other docs/config.

## Runtime and auth

- ESM TypeScript, Node 22; better-sqlite3 + Drizzle ORM; SQLite schema initialisation/migrations run on boot.
- Backend exports createApp({dbPath, token?, serveStatic?, clock?}) from src/server/app.ts returning Fastify instance; supports inject for tests. DB helpers exported from src/server/db.ts (or document exact equivalent).
- Server binds 127.0.0.1, default PORT=4317. Database DATA_DIR/leetcode.sqlite, default ~/Library/Application Support/LeetcodeTutor-dev/ (isolated pilot until cutover).
- Runtime writes a random 0600 token at DATA_DIR/api-token. MCP/CLI read this locally (no secrets in stdout). Authorization: Bearer token supports protected API reads/writes. Browser obtains same-origin session cookie and csrfToken via GET /api/session. Browser mutations send X-CSRF-Token; no CORS wildcard. Validate Host/Origin including loopback and configured port. Browser cannot receive bearer token.
- Every endpoint except /health and /api/session requires authenticated cookie or bearer. JSON errors {error:{code,message}}; 400 validation,404 missing,409 version/idempotency conflict. Body limits. /health returns {ok:true} with no private info.
- UI api.ts handles session initialisation and CSRF before API calls. API prefix always /api. Responses JSON serialisable with DTOs in src/shared/contracts.ts.
- HTTP routes are the canonical business logic; MCP only calls them. No SQL tools/code runner/automatic agent invocation.

## Endpoints (names and shapes are fixed)

GET /api/dashboard?date=YYYY-MM-DD -> Dashboard. Reads only; UI first calls ensure plan.
POST /api/daily-plan/ensure {date?:string} -> DailyPlan (idempotent date/timezone; resume existing active across date without creating second).
POST /api/plan-items/:id/disposition {action:'swap'|'snooze'|'skip', until?:date, reason?:string} -> DailyPlan. No attempt evidence for skipped assignments. Optional activation: POST /api/plan-items/:id/activate {} -> DailyPlan.
GET /api/problems?search=&status=all|completed|attempted&tags=id,id&tagMode=any|all&tagDifficultyMin=&tagDifficultyMax=&listId=&difficulty=&timeBucket=0-10|10-20|20-30|30-45|45+|unknown&sort=title|lastAttempt|solveTime|reviewDate|tagDifficulty&direction=asc|desc&page=1&pageSize=25 -> {items:Problem[],total:number,page:number,pageSize:number}.
POST /api/problems {title,url,difficulty?:'Easy'|'Medium'|'Hard'|null,notes?:string,listIds?:string[],tags?:{tagId,difficulty?:number|null}[]} -> Problem. Validate original URL strictly; only recognised LeetCode problem paths, preserve original if normalised separately; dedupe slug. No SSRF/remote fetching.
GET /api/problems/:id -> {problem:Problem,attempts:Attempt[],reviews:ReviewTarget[]}.
PATCH /api/problems/:id {title?,notes?,difficulty?,tags?:{tagId,difficulty:number|null}[],listIds?:string[]} -> Problem.
GET /api/tags -> Tag[]. POST /api/tags {name,description?} -> Tag. PATCH /api/tags/:id {name?,description?,archived?} -> Tag.
GET /api/lists -> ProblemList[]. POST /api/lists {name,sourceUrl?,sourceVersion?} -> ProblemList.
GET /api/topics -> Topic[]. GET /api/topics/:id -> {topic:Topic,decisions:ScoreDecision[],attempts:Attempt[],problems:Problem[],stats:{attemptCount:number,knownTimeCount:number,medianSeconds:number|null}}. Optional evidence/help/difficulty filters.
POST /api/attempts {problemId,planItemId?:string,context:'mixed'|'targeted'|'review',language?:string} -> Attempt; one active/paused attempt max. Starting a completed known problem is repeat, not unseen.
GET /api/attempts/:id -> Attempt (contains only title/URL public problem identity, NO hidden tags/history).
GET /api/attempts/:id/context -> {attempt:Attempt,history:Attempt[],topics:Topic[]} (for Hermes post-attempt; reject active mixed assessment unless explicit review/help phase).
PATCH /api/attempts/:id/draft {version,code?,notes?,language?} -> Attempt. Optimistic version required; serialise UI save/timer requests per attempt to avoid race.
POST /api/attempts/:id/timer {version,action:'pause'|'resume'|'heartbeat',includeGap?:boolean} -> Attempt. Server persists active seconds; clock injectable; long gap pauses at last heartbeat with needsGapDecision flag. Switching browser tab not itself pause.
POST /api/attempts/:id/finish {version,outcome:'solved'|'not_solved'|'stopped',help:'none'|'small'|'major'|'solution'|'unknown',activeSeconds:number|null,code?,notes?,confidence?:number|null,reviewDate?:string|null,reviewAction?:'recommended'|'manual'|'none'} with Idempotency-Key -> Attempt. Atomic final answer, plan transition, review recommendation. Same key different payload ->409; duplicate key same payload returns committed response even stale version.
POST /api/attempts/:id/reviews {version,feedback,decisions:[{topicId,expectedVersion,oldScore,newScore,rationale,evidence:'retention'|'near_transfer'|'unseen'|'mock'}],followUp?:{date:string|null,action:'recommended'|'manual'|'none'}} with Idempotency-Key -> {attempt:Attempt,decisions:ScoreDecision[]}. Store absolute score values, enforce0? NO scores 1..5, no unsupported increase above3 from repeats; unchanged legacy >3 allowed. Atomic review+score history+current score. Respect prior manual review override when followup recommendation only.
GET /api/reviews -> ReviewTarget[]. PATCH /api/reviews/:id {version,action:'manual'|'snooze'|'none'|'recommended',date?:string|null} -> ReviewTarget.
GET /api/settings -> Settings. PATCH /api/settings {timezone?,budgetMinutes?,primaryCount?,optionalCount?} -> Settings.

## Export/import/backup contract (backend implements, integrations consumes)

GET /api/export -> {schemaVersion:1,exportedAt:string,tables:Record<string,Record<string,unknown>[]>}. Export all durable user tables with FK IDs, exclude credentials/idempotency secret session state. Import raw unknown values retained. Document actual table allowlist in code. This format can restore into an EMPTY db.
POST /api/restore {snapshot:<export object>,confirmEmpty:true} -> {restored:true,counts:Record<string,number>}; validate schema/table allowlist, transactional, reject nonempty DB and malicious keys/schema; admin bearer only.
POST /api/backup {} -> {path:string,createdAt:string}; backend consistent SQLite backup within DATA_DIR/backups only, no caller arbitrary filesystem path. Bearer only.
POST /api/import {importId, dryRun:boolean, source:{spreadsheetId?,retrievedAt}, problems:ImportProblem[], attempts:ImportAttempt[], topics:ImportTopic[], movements:ImportMovement[], planned:ImportPlan[], records:ImportRecord[]} -> {dryRun,counts:Record<string,number>,warnings:string[],unresolved:ImportRecord[]}. Bearer only, exact repeat importId must be no-op on apply. Dry run must not mutate DB. Imports insert source data preserving code/ratings/raw; don't fabricate time. Planned dates become candidates not all overdue mandatory work. Integration child maps workbook source; backend consumes canonical records. Fixed import DTOs below.
ImportProblem {key:string,title:string,url:string,difficulty?:string|null,notes?:string,legacyCompleted?:boolean,exposed?:boolean,tags?:string[],lists?:string[]}.
ImportAttempt {sourceKey:string,problemKey:string,date:string,outcome:'solved'|'not_solved'|'stopped',help:'none'|'small'|'major'|'solution'|'unknown',activeSeconds:number|null,notes:string,code?:string,evidence:string,nextReviewDate?:string|null,topicNames?:string[]}.
ImportTopic {name:string,score:number|null,notes:string,lastReviewed?:string|null,provisional:boolean}.
ImportMovement {sourceKey,topicName,problemKey?,date,oldScore:number,newScore:number,rationale:string,evidence:string}. Historical movements do NOT change imported current score.
ImportPlan {sourceKey,problemKey?:string,date:string,status:string,notes:string}.
ImportRecord {sourceKey:string,tab:string,row:number,raw:unknown,status:'imported'|'metadata'|'duplicate'|'unresolved',reason?:string}.

## UI expectations

Production UI must call real backend, never fall back to fake data. Empty/helpful error states. Dashboard has full today plan + existing topic scores + movements + recent practice. Library CRUD/tag/list filters; problem history/details editable. Dedicated hidden-safe attempt editor and closeout; topic scores/history pages; settings workload/timezone and download export. Use tasteful compact light/dark-aware visual design, keyboard labels and responsive layout. No meaningless buttons. Demo fixture data ONLY in tests.

## Verification

Parent owns npm scripts/config. npm test, npm run typecheck, npm run lint, npm run build, npm run test:e2e. Child tests use tests/backend, tests/web, tests/integrations respectively. Tests use temp db/profile; NEVER write real Hermes config, credentials, Sheet or pilot DB. Report contract mismatches immediately.
