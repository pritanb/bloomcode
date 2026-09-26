# Project conventions

BloomCode is a single-user, local-first study app. Keep changes small and tests proportional.

## Verification

Follow [docs/testing.md](docs/testing.md): test critical functions only and iterate quickly.

- Protect saved work, correct scores and schedules, import/backup integrity, authentication and MCP tools.
- Run the tests for the function you changed. Run the full critical suite for cross-cutting logic, not for CSS or copy edits.
- Keep one browser practice/save/reload flow and run it when that workflow changes.
- Do not add per-screen, theme or viewport matrices, cosmetic assertions, duplicate test layers or automatic multi-agent review cycles.
- Inspect the affected screen after design edits; typecheck after TypeScript changes.
- Never use your real workspace for QA: reading a question can record pattern exposure. Start your own server on a disposable database.

Do not change study data, scoring rules or MCP client configuration as a side effect of UI work.
