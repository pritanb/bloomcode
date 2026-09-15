# Browser acceptance QA

## Verified release checks

The production build was exercised with real Chromium, Fastify and disposable SQLite. `npm run test:e2e` passes **six journeys**, covering:

1. Empty-state dashboard without invented progress.
2. Tag, list and question creation; URL-persisted discriminating catalogue filters and per-tag difficulty.
3. Targeted practice, CodeMirror editing, serialised autosave, reload recovery, pause/resume, unknown timing and no scheduled review.
4. Explicit completion time, manual review override and time-bucket filtering.
5. Blind mixed practice, denied active context access, authenticated tutor-review API writes, score refresh, explicit no-change history and idempotency.
6. Light/dark system preference, sample text/field contrast assertions and live CodeMirror theme switching.

Screenshots are written under `test-results/` and attached to the Playwright report. Desktop and mobile screenshots were inspected. Viewport overflow assertions pass. The harness now shares one temporary DATA_DIR through the process environment; no `lsof` workaround or reused external server is needed.

The browser suite uses **clearly labelled disposable fixtures**, not live study records. The tutor review journey uses the authenticated HTTP API; separate integration tests exercise the actual stdio MCP SDK transport.

## Issues found and resolved

- Same-origin Vite development proxy mutations failed. The proxy now translates only genuinely same-origin requests; hostile origins remain rejected.
- An initially empty daily plan did not refill after questions were added. Only untouched empty plans refill; active work/history/overrides remain stable.
- Metadata browsing failed to invalidate unseen evidence. Catalogue reads now record disclosure, and active mixed questions cannot be retrieved through catalogue/detail/topic bypasses. Fixtures obtain internal identity via their test-admin export rather than leaking patterns before an unseen assessment.
- Dark preference was ignored. CSS surfaces and CodeMirror follow system preference, with screenshot review and a contrast regression.

## Real-data verification

`tests/smoke/real-data.mjs` verifies an explicitly chosen pilot without reading catalogue metadata or starting practice. It checks raw provenance, source question fields, all attempts and explicit score decisions, current scores, and the exact membership sets of all three public lists.

`tests/smoke/pilot-browser.mjs` was run against a **restored disposable copy** of the corrected real-data pilot. Dashboard, library, topic/detail and settings pages loaded; desktop/mobile overflow and uncaught-exception checks passed. Screenshots were visually inspected. This copy—not the authoritative pilot—absorbed the deliberate catalogue exposure caused by QA.

## Scope and limitations

- Chromium on this Mac is tested; this is not a Safari/Firefox or real-device certification.
- The timer is self-reported active time, not LeetCode judge telemetry.
- Code is edited/stored, not executed or automatically judged.
- Pilot reconciliation decisions and Hermes source-of-truth cutover require separate approval.
- Vite reports a non-blocking bundle-size warning for the lazy CodeMirror workspace chunk.
