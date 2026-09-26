# Contributing

Use Node.js 22.23 or later and `npm ci`. Contributions are accepted under the [MIT License](LICENSE).

## Development

`npm run electron:dev` runs the full desktop app with live UI updates; see [Desktop](docs/desktop.md#develop-with-live-ui-updates).

For a browser-only loop, run the backend and Vite in two terminals with a disposable workspace:

```sh
DATA_DIR=$(mktemp -d) PORT=4346 npm run dev   # backend, restarts on change
TUTOR_DEV_API_PORT=4346 npm run dev:web        # UI at http://127.0.0.1:5173
```

Vite proxies `/api` to the backend port. These commands do not load `.env`. Never point QA at your real workspace: even reading question details can record exposure.

## Checks

Follow [docs/testing.md](docs/testing.md). Typecheck TypeScript changes and run the tests for the function you changed. GitHub runs typechecking, lint, the format check, the critical tests and a startup smoke check on Linux.

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:smoke
npm run test:e2e
```

The browser suite uses its own temporary database and server. Install Chromium with `npx playwright install chromium` if needed.

Keep changes small and preserve saved work, explicit review dates and source provenance. Extension examples belong in `examples/`; tokens, progress exports, logs and database files do not belong in commits. See the [extension guide](docs/extensions.md).
