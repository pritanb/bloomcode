# LeetCode Tutor

A local study workspace built with **React + Vite, Fastify and SQLite/Drizzle**. The study desk shows a small daily plan; the question library keeps the detailed organisation out of the daily workflow.

## Open the app

Double-click `scripts/LeetCode Tutor.command`, or run:

```sh
cd /Users/pritanbarai/Projects/leetcode-tutor
./scripts/start-local.sh
```

Open **http://127.0.0.1:4317**. The launcher starts or reuses this app's authenticated local server. It does not install a login item or a background scheduling service.

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
- **Topic progress** — the existing decimal 1–5 scores, evidence, explicit score decisions and no-change rationales. Topic proficiency and a question's per-tag 1–10 difficulty are separate concepts.
- **Settings & data** — adjust the time budget and primary/optional workload; download a portable export.

Code is **stored, not executed**. This app is not a LeetCode judge and does not automatically submit answers, scrape paid statements or invoke a model. Submit on LeetCode and record the result here. The tutor-review API/MCP adapter records evidence-based feedback and score decisions; merely finishing an attempt does not change a topic score.

## Data and cutover

The default data directory is:

```text
~/Library/Application Support/LeetcodeTutor-dev/
```

It contains the SQLite database, private local API credential, source-import artefacts and backups. It is outside the repository. Keep it private. Never put its credential in a prompt, Git commit or MCP configuration.

**The installed data mode is an isolated pilot.** The live Sheet and existing Hermes tutor configuration remain unchanged. Source ambiguities are preserved for reconciliation, not guessed. Do not alternate between writing the Sheet and writing the app as two authoritative histories. Approve the import and choose one source of truth before switching normal tutoring.

[Migration and provenance](docs/migration.md) describes the read-only Sheet mapper, unresolved fields and separately verified NeetCode 150 / NeetCode 250 / Blind 75 manifests.

## Backups and recovery

```sh
npm run backup
node --import tsx scripts/export.ts --output /absolute/existing-directory/tutor-export.json
```

The backup command uses SQLite's consistent backup operation and verifies database/foreign-key integrity. Portable restore only accepts an empty target and compares all exported tables after restoration. See [operations](docs/operations.md) for the isolated restore drill, start/stop procedure and troubleshooting. Backups on this Mac do not replace an encrypted off-device copy.

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

If Chromium is missing: `npx playwright install chromium`. **Use the lightweight workflow in [Testing policy](docs/testing.md):** 36 critical function tests and one optional browser solve/save/reload flow. Cosmetic changes need an affected-screen check, not the entire suite. Browser tests use an isolated temporary database and port 4318; they refuse to reuse another running server.

The Vite development proxy translates legitimate local same-origin requests while preserving the backend's Host, Origin and CSRF checks. The production app serves its own static UI and binds only to loopback. This is a personal single-user application, not a publicly deployable multi-user service.

## UI

The UI uses the actual shadcn/ui Radix Nova registry components, Tailwind CSS v4, a neutral palette and system sans-serif text. It follows the system light/dark preference. See [UI design system](docs/design-system.md) for component and layout conventions.

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
