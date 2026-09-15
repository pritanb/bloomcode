# Local pilot release verification

## Result

The original Vite + React + Fastify + SQLite implementation runs locally. The MCP adapter is implemented and tested, but not registered in the user's Hermes configuration. The Sheet remains authoritative until import reconciliation and cutover are approved.

## Executed gates

| Gate | Result |
|---|---|
| TypeScript | `npm run typecheck` passed |
| ESLint | `npm run lint` passed |
| Unit/integration/regression suite | `npm test`: 147 passed across 22 files |
| Production startup | `npm run test:smoke` passed with real SQLite migrations, flat built entrypoints, authenticated API and SPA deep link |
| Chromium acceptance | `npm run test:e2e`: six journeys passed; desktop/mobile screenshots inspected |
| Dependency audit | `npm audit --json`: zero known vulnerabilities |
| Static sensitive-pattern scan | 101 source/document files checked; no findings in the checked key, private-key, shell-injection and unsafe-deserialisation patterns |
| Independent backend review | Passed after two bounded fix cycles; no remaining concerns in the reviewed scope |
| Real-data reconciliation | 293 questions; 114 historical attempts; 20 unchanged topic scores; 107 explicit score decisions |
| Public-list provenance | Exact 150/75/250 membership sets verified; NeetCode 250 asset independently re-fetched and checked |
| Backup and recovery | SQLite backup passed integrity check; full export restored to a fresh database with every table compared |

The independent reviews found and caused fixes for metadata-disclosure scoring bypasses, repeated-snapshot history duplication and untouched empty-plan refill. Retained regression tests exercise these cases, including mutation responses, rollback and restart durability.

## Data boundary

The corrected pilot is in `~/Library/Application Support/LeetcodeTutor-dev`. The earlier pilot is archived separately, not deleted. Personal snapshots, tokens, exports and reconciliation records are outside Git.

Before cutover, review 33 unresolved source records (31 timings, two unsupported URLs) and 33 composite topic references. These categories may overlap by source row. Original cells and source provenance are retained; unsupported identities, durations and topic links were not guessed. Per-record details are in the pilot's `imports/reconciliation.md` and `imports/reconciliation.csv`.

## Limits

- This is a single-user loopback application, not a remotely deployed service or a multi-user security assessment.
- No code execution, judge integration, full problem-statement scraping or automatic model calls.
- Chromium is tested; Safari/Firefox and physical mobile devices are not certified.
- The lazy CodeMirror workspace produces a non-blocking Vite chunk-size warning.
- Registration of the MCP adapter and switching the tutor's source of truth require a separate approved cutover.
