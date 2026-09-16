# Project conventions

This is Pritan's personal LeetCode study app, not a multi-user enterprise service.

## Verification scope

Follow `docs/testing.md`. The user explicitly wants only critical function tests and faster iteration.

- Protect saved work, correct scores/schedules, import/restore integrity, auth and MCP functionality.
- Run tests relevant to the changed function. The full critical suite is appropriate for cross-cutting logic changes, not every CSS or copy edit.
- Keep one browser practice/save/reload flow, invoked when that workflow changes.
- Do not add per-screen/theme/viewport matrices, cosmetic token assertions, duplicate test layers or automatic multi-agent review cycles for routine changes.
- Visually inspect the affected screen for design edits; typecheck when TypeScript changes.
- Do not access the live pilot for QA. Reads can record pattern exposure. Own a disposable database and server rather than reusing a live URL.

Keep changes small. Do not change study data, scoring rules or Hermes/Sheet cutover configuration as a side effect of UI work.
