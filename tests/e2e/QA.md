# Browser smoke test

The current suite contains one critical workflow in `journeys.spec.ts`: create a practice question, start an attempt, enter code/notes, autosave, pause, reload, resume, finish and read back the persisted result.

Run after changes to this workflow:

```sh
npm run build
npm run test:e2e
```

It uses the configured disposable SQLite database and non-reused test server. No live pilot access, screenshot matrix, theme sweep or per-page visual gate. Trace/screenshot capture on failure remains available through Playwright configuration.

See `docs/testing.md` for the current proportional verification policy. Earlier design/release reports document historical checks, not ongoing requirements.
