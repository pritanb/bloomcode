# Testing

BloomCode is a local-first, single-user app. Tests are sized to the risk of losing work or recording wrong results, not to the number of screens.

## What runs

`npm test` runs the critical function suite:

- Saved drafts, timer gaps, optimistic versions and duplicate-safe closeout.
- Scoring transactions, rollback and pattern-disclosure safeguards.
- Stable daily plans and manual review-date precedence.
- Import deduplication, ambiguous source handling and backup/restore integrity.
- Local API authentication/CSRF, browser mutation ordering and lost-response retry.
- One real MCP protocol flow and verified-list ingestion.

`npm run test:e2e` runs two startup checks and one browser practice flow on a disposable database: create a workspace, open a result report, enter notes and solution code, autosave, reload, enter the LeetCode solve time and check the saved result. Build first if application code has changed.

Both suites finish in seconds.

## What to run for a change

| Change                             | Verification                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Copy, colours, spacing or icons    | Inspect the affected screen                                                           |
| UI interaction or TypeScript logic | Relevant test file(s), typecheck; browser flow only if practice/save flow is affected |
| Scoring, scheduling or persistence | Relevant critical tests; full `npm test` for changes spanning these functions         |
| Import, backup or restore          | Relevant integration tests on disposable data                                         |
| Startup, build or dependencies     | Build; optionally `npm run test:smoke`                                                |

Run one file with `npm test -- tests/web/attemptQueue.test.ts`. Never use your real workspace for QA.

## What not to add

Screen × viewport × theme matrices, font/colour/layout assertions, repeated mocked UI workflows and duplicate startup scripts were removed. Git history has them if a regression ever needs one back.

Add a regression test only when it protects a critical function or a real data-loss or wrong-record bug. Ordinary cosmetic or test changes need no separate review. Save security review for changes to authentication, data exposure or destructive operations.
