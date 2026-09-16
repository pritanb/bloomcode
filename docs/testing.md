# Testing policy

This is a personal, single-user study app. Keep tests proportional to the risk of losing work or producing incorrect study records—not the number of screens or components.

## Kept

`npm test` runs 36 critical function tests:

- Saved drafts, timer gaps, optimistic versions and duplicate-safe closeout.
- Scoring transactions, rollback and pattern-disclosure safeguards.
- Stable daily plans and manual review-date precedence.
- Import deduplication, ambiguous source handling and backup/restore integrity.
- Local API authentication/CSRF, browser mutation ordering and lost-response retry.
- One real MCP protocol flow and verified-list ingestion.

`npm run test:e2e` runs one browser flow: open a result report, enter notes and required solution code, autosave, reload, enter LeetCode solve time, and verify the saved result. It uses a disposable database. Build first if application code has changed.

The reduced suites were exercised in 6.87 seconds (functions) and 5.5 seconds (browser, including startup) on this Mac. These are observations, not performance guarantees.

## What to run for a change

| Change | Verification |
|---|---|
| Copy, colours, spacing or icons | Inspect the affected screen; no full test suite or review-agent cycle |
| UI interaction or TypeScript logic | Relevant test file(s), typecheck; browser flow only if practice/save flow is affected |
| Scoring, scheduling or persistence | Relevant critical tests; full `npm test` for changes spanning these functions |
| Import, backup or restore | Relevant integration/regression tests on disposable data |
| Startup/build/dependency changes | Build; optional `npm run test:smoke` |

Run a relevant file with `npm test -- tests/web/attemptQueue.test.ts` (or its corresponding domain file). Never use the real pilot database for QA.

## Removed

The full screen × viewport × theme matrix, font/colour/layout assertions, repeated mocked UI workflows, overlapping reviewer probes, CLI mock duplicates and redundant startup/visual scripts were deleted—not merely skipped or hidden behind a default filter. Git history retains them if a specific regression ever warrants bringing a case back.

Do not rebuild the removed matrices. Add a small regression only when it protects a critical function or a demonstrated data-loss/incorrect-record bug. Do not require independent review agents for ordinary cosmetic or test-maintenance changes. Broader security review is reserved for meaningful changes to authentication, data exposure or destructive operations.

Older release/design verification reports describe historical coverage; this document governs the current workflow.
