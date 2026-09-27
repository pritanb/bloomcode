# Desktop app (macOS)

BloomCode uses Electron to package its interface, local server and runtime in one application. Once installed, it needs neither Node.js nor the project folder. Builds target Apple silicon Macs; Intel, Windows and Linux are not supported yet.

## Install and open

1. Download the Apple silicon ZIP from the [v0.2.0 preview release](https://github.com/pritanb/bloomcode/releases/tag/v0.2.0), unzip it and move the app to Applications. The application is named **BloomCode.app**.
2. Open it, then drag its icon to the Dock for one-click access.
3. For a new workspace, choose your timezone, daily target and starter question list.

Builds are not yet Developer ID signed or notarized. macOS may block a downloaded copy; for a build you trust, follow [Apple's instructions for opening an unnotarized app](https://support.apple.com/en-au/102445).

## Build from source

Building requires macOS, Node.js 22.23 or later, Apple's Command Line Tools and internet access.

```sh
npm ci
npm run electron:make -- --arch=arm64
```

The installable ZIP is under `dist/electron/make/zip/darwin/arm64/`. To create only the application bundle, use `npm run electron:package -- --arch=arm64`; its output is `dist/electron/BloomCode-darwin-arm64/BloomCode.app`.

The build stages its own runtime dependencies, including Electron's SQLite binary. Your workspace, API token and `.env` are never packaged.

### Develop with live UI updates

`npm run electron:dev` builds the backend, starts Vite on port 5173 and opens the Electron window. React and CSS edits update live; restart the command after backend or Electron changes.

By default it uses your normal workspace and port, so quit the installed app first. For QA, use disposable data:

```sh
DESKTOP_TEST_DATA_DIR=$(mktemp -d /tmp/leetcode-dev-XXXXXX) DESKTOP_TEST_PORT=4346 npm run electron:dev
```

This isolates both the study records and the Electron profile. Close the window to stop the backend and Vite.

## Build on GitHub

Open **Actions → Build desktop app → Run workflow**, then download the `bloomcode-macos-arm64` artifact from the finished run and unzip the app archive inside. The workflow runs on an Apple silicon runner, keeps the archive for 14 days, and does not sign, notarize or publish a release.

## Workspace and updates

Study records live outside the app in `~/Library/Application Support/BloomCode/`; existing `LeetCodeTutor` and `LeetcodeTutor-dev` workspaces keep their location. Replacing the app leaves this data alone. The app backs up daily; run `npm run backup` for an extra copy before updating. See [Operations](operations.md) for restore steps.

The packaged app does not read `.env`. It uses the standard workspace and port `4317` unless `DATA_DIR` or `PORT` are set in its launch environment.

## Startup and optional tutor

The app owns its local server. Quitting stops it; opening the app twice brings the existing window forward. Keep the app open while an MCP client is connected. If another server already holds the workspace or port, the app reports it rather than stopping that process.

For tutor reports, choose **Settings → AI tutor → Codex**. MCP clients connect to the same workspace and port through the adapter built from this repository, which needs Node.js; see [tutor setup](tutor-integration.md).
