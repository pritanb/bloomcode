# LeetCode Tutor

A local study workspace built with **React + Vite, Fastify and SQLite/Drizzle**. The study desk shows a small daily plan; the question library keeps the detailed organisation out of the daily workflow.

## Open the app

Double-click `scripts/LeetCode Tutor.command`, or run:

```sh
cd /Users/pritanbarai/Projects/leetcode-tutor
./scripts/start-local.sh
```

Open **http://127.0.0.1:4317**. The launcher starts or reuses this app's authenticated local server only when it matches the current build. After rebuilding, an older running server must be stopped before launching again; the launcher reports this instead of opening incompatible frontend/backend versions. It never automatically kills an existing server. It does not install a login item or a background scheduling service.

For a fresh checkout, use Node.js 22 or later:

```sh
npm ci
npm run build
./scripts/start-local.sh
```

## Study workflow

- **Study desk** — start or resume a question, swap it, snooze it or skip it. The plan refreshes for the local study date when the app is opened, and the open dashboard checks periodically. Missed days don't create catch-up quotas.
- **Question library** — search questions; combine custom pattern tags, per-question tag difficulty, list membership, completion status, LeetCode difficulty and solve-time bands. Filters stay in the URL.
- **Attempt workspace** — Python/Java code editing, notes, active timer, pause/resume, automatic draft saving and reload recovery. Mixed practice hides topic and solution metadata. Finish with an outcome, help level, optional confidence and either known or unknown time.
- **Review scheduling** — accept the recommendation, choose a date or opt out. A manual choice is not silently replaced by a recommendation.
- **Weekly recap & activity** — counts from saved study dates, supporting attempts and recorded score changes, plus a 28-day practice strip.
- **Mistake notebook** — optional mistake labels and takeaways on completed attempts, searchable across questions.
- **Attempt comparison** — explicitly reveal the previous completed solution after finishing, alongside recorded time, help and notes.
- **Review calendar** — browse seven-day windows and reschedule with the existing manual-date rules.
- **Tag notebooks** — every tag has recognition cues, pitfalls and notes, with assigned questions appearing automatically. Imported and custom tags use the same notebook and question assignment controls. Mixed practice blocks notebook access; revealing linked questions records exposure.
- **Topic progress** — the existing decimal 1–5 scores, evidence, explicit score decisions and no-change rationales. Topic proficiency and a question's per-tag 1–10 difficulty are separate concepts.
- **Settings & data** — choose questions per day, study timezone and daily recommendation policy; download a portable export.

Code is **stored, not executed**. This app is not a LeetCode judge and does not automatically submit answers, scrape paid statements or invoke a model. Submit on LeetCode and record the result here. Finishing an attempt moves topic scores automatically under conservative evidence rules: independent unseen solves can raise a score towards 5, every other result is capped at 3, and misses on known material lower it slightly. The tutor-review API/MCP adapter can still record manual feedback and score decisions, which override the automatic movement. Automatic scoring can be turned off in Settings.

### Daily recommendation policy

Settings offers **All questions** or **one available list only**, mixed/balanced selection or topic-by-topic progression, a starting topic, and completed-question exclusion or a capped refresher allowance. Existing installations keep the original balanced selection until settings are changed. A chosen list is a hard boundary for new assignments, due reviews, refreshers and swaps; an exhausted pool produces a shorter or empty plan, never outside-list filler.

NeetCode lists use the checked-in NeetCode 250 category/question order. Other lists use alphabetical topic order, assigning each question to its first alphabetical non-archived topic tag (or Uncategorized). Progress counts imported completion flags and any saved solved attempt once per question. Failed retries never remove completion credit. An unstarted assignment is still eligible tomorrow; an unfinished draft resumes first, including after restart. Topics advance only after completion, not because all remaining questions are snoozed. You can choose a later starting topic explicitly.

Refreshers revisit completed questions within the same source limit, preferring Blind 75 / NeetCode 150 membership as a curated core—not measured popularity. Slots are part of the daily count, not extra work. Manual review dates and “no review” choices remain authoritative. Known-topic assignments use the app's targeted-practice evidence path, not unseen mixed evidence; no score is automatically changed.

Saving settings does **not** replace an existing plan. **Rebuild unstarted current plan** explicitly applies saved settings while retaining active drafts, completed/skipped assignments, saved attempts, scores and review choices. Preserved work may remain outside a newly selected list or above a reduced daily target. Recommendation settings and assignment kinds are included in export/restore; older snapshots without them retain legacy defaults.

## Data and cutover

The default data directory is:

```text
~/Library/Application Support/LeetcodeTutor-dev/
```

It contains the SQLite database, private local API credential, source-import artefacts and backups. It is outside the repository. Keep it private. Never put its credential in a prompt, Git commit or MCP configuration.

**This app is the authoritative study tracker.** Cutover was approved on 2026-09-17 using the imported Sheet history plus current app data; the legacy unresolved timings, URLs and composite topic labels remain preserved as explicit unknowns in the source archive rather than guessed. The Sheet is a read-only historical archive — never write study updates to it, and do not maintain two histories. The `leetcode-tutor` MCP server is registered in the default Hermes profile (see [operations](docs/operations.md#mcp-adapter)).

[Migration and provenance](docs/migration.md) describes the read-only Sheet mapper, unresolved fields and separately verified NeetCode 150 / NeetCode 250 / Blind 75 manifests.

## Backups and recovery

```sh
npm run backup
node --import tsx scripts/export.ts --output /absolute/existing-directory/tutor-export.json
```

The backup command uses SQLite's consistent backup operation and verifies database/foreign-key integrity. Portable restore only accepts an empty target and compares all exported tables after restoration. New exports use snapshot version 3. Versions 1 and 2 still restore: former standalone notebook entries merge into matching pattern tags, with notes and question links preserved. Existing tag difficulty, scores and schedules remain unchanged. See [operations](docs/operations.md) for the isolated restore drill, start/stop procedure and troubleshooting. Backups on this Mac do not replace an encrypted off-device copy.

## Hermes / MCP

The built stdio adapter is `dist/server/mcp.js`. It exposes six bounded tools for today's plan, question search, attempt context, attempt completion, tutor review and review dates. It calls the same authenticated API as the UI, not the database directly.

Registration in Hermes is **not performed automatically**. See [operations](docs/operations.md#mcp-adapter) for the command and configuration requirements. The application must be running before an MCP client uses it.

## Development and verification

```sh
npm run dev         # Fastify, 127.0.0.1:4317
npm run dev:web     # Vite UI, in another terminal

npm run typecheck
npm run lint
npm test
npm run test:smoke  # Builds, boots production server and checks real runtime
npm run test:e2e    # Playwright user journeys against the build
```

If Chromium is missing: `npx playwright install chromium`. **Use the lightweight workflow in [Testing policy](docs/testing.md):** critical function tests and one optional browser solve/save/reload flow. Cosmetic changes need an affected-screen check, not the entire suite. Browser tests use an isolated temporary database and port 4318; they refuse to reuse another running server.

The Vite development proxy translates legitimate local same-origin requests while preserving the backend's Host, Origin and CSRF checks. The production app serves its own static UI and binds only to loopback. This is a personal single-user application, not a publicly deployable multi-user service.

## UI

The UI uses the actual shadcn/ui Radix Nova registry components, Tailwind CSS v4, warm off-white surfaces, restrained indigo accents and system sans-serif text. Dark mode uses charcoal surfaces; theme selection follows the system until explicitly changed. See [UI design system](docs/design-system.md) for component and layout conventions.

## Repository map

| Path | Responsibility |
|---|---|
| `src/web/` | React screens, CodeMirror and API client |
| `src/server/` | Fastify, auth, domain operations and SQLite access |
| `src/shared/contracts.ts` | Browser/API/MCP data contracts |
| `src/integrations/` | MCP, Sheet mapping, public-list provenance and CLI helpers |
| `drizzle/` | Tracked database migration |
| `scripts/` | Launcher, imports, backup/export/restore |
| `tests/` | Domain, integration, component, release regression and browser tests |
| `docs/` | Product/technical design, migration and operations |

Original implementation specifications: [product design](docs/prd.md), [technical design](docs/technical-design.md), [API contract](BUILD-CONTRACT.md).
