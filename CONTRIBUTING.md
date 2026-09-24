# Contributing

Use Node.js 22.23 or later and `npm ci`. The project license is still undecided; resolve that before contributing substantial code intended for redistribution.

For development, run `npm run dev` and `npm run dev:web` in separate terminals. Set `DATA_DIR` to an absolute disposable directory in both your app and integration environment. Development commands do not load `.env` automatically. Never use a real study database for QA: even reading question details can record exposure.

Follow [docs/testing.md](docs/testing.md). Run typechecking for TypeScript changes and tests relevant to the changed function. Persistence/import/authentication changes warrant the critical suite. Build before browser verification. GitHub runs typechecking, lint, critical tests and the production startup smoke check on Linux; it does not create viewport/theme matrices.

```sh
npm run typecheck
npm run lint
npm test
npm run test:smoke
npm run test:e2e
```

The browser suite owns a temporary database and refuses to reuse another server. It includes the onboarding-to-practice/save/reload flow. Install Chromium with `npx playwright install chromium` if needed.

Keep changes small, document compatibility changes, and preserve saved work, explicit review dates and source provenance. Extension examples belong in `examples/`; private tokens, progress exports, logs and database files do not belong in commits. See [Extension guide](docs/extensions.md).
