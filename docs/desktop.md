# Desktop app (macOS)

LeetCode Tutor uses Electron to package its study interface, local server and runtime in one application. Once installed, it does not need Node.js or the project folder. The initial target is Apple silicon Macs; Intel, Windows and Linux packages have not been verified.

## Install and open

1. Download the Apple silicon ZIP from the [latest release](https://github.com/pritanb/leetcode-tutor/releases/latest). Unzip the desktop build archive and move **LeetCode Tutor.app** to Applications.
2. Open it, then drag its icon to the Dock for one-click access.
3. For a new workspace, choose your timezone, daily target and starter question list.

Builds are not yet Developer ID signed or notarized. macOS may block a downloaded copy; for a build you trust, follow [Apple's instructions for opening an unnotarized app](https://support.apple.com/en-au/102445).

## Build from source

Building requires macOS, Node.js 22.23 or later, Apple's Command Line Tools, and internet access to download dependencies. These are build requirements only.

```sh
npm ci
npm run electron:make -- --arch=arm64
```

The installable ZIP is under `dist/electron/make/zip/darwin/arm64/`. To create only the application bundle, use `npm run electron:package -- --arch=arm64`; its output is `dist/electron/LeetCode Tutor-darwin-arm64/LeetCode Tutor.app`.

The desktop build stages its own runtime dependencies, including Electron's SQLite binary. Your workspace, API token and `.env` file are not included in the package.

## Build on GitHub

After the workflow is on the repository's default branch, open **Actions → Build desktop app → Run workflow**. Download the `leetcode-tutor-macos-arm64` artifact from the completed run, extract it, then unzip the app archive inside.

This manual workflow builds on an Apple silicon macOS runner and keeps the archive for 14 days. It does not publish a GitHub release or sign/notarize the app. A signed public release requires a separately configured Apple Developer identity and notarization credentials.

## Workspace and updates

Study records stay outside the application in `~/Library/Application Support/LeetCodeTutor/`. Existing databases in `LeetcodeTutor-dev` keep their original location. Replacing the application does not replace this data. Export your records from Settings before updating; see [Operations](operations.md) for backup and restore details.

The packaged app does not read a project's `.env` file. It uses the standard workspace and port `4317`, unless `DATA_DIR` or `PORT` are supplied in its launch environment. If your browser setup uses a custom workspace, use matching settings before switching to desktop.

## Startup and optional tutor

The desktop app owns its local server. Closing the window or choosing Quit stops that server; opening the app twice brings the existing window forward. Keep the app open while using browser or MCP connections.

If an older browser server is still running, stop it before opening the desktop app. The app reports an occupied workspace or port instead of terminating another process. See [Operations](operations.md) for stopping an existing server.

Existing MCP clients can connect to the desktop server using the same workspace and port. The desktop package does not configure a tutor client or provide a standalone MCP installer: the [optional tutor setup](tutor-integration.md) still uses Node.js and the adapter built from this repository. Normal practice and saving need neither.

The earlier Swift launcher depended on a local project and Node installation. Electron replaces that launcher; its old build command is not needed for the self-contained app.

## Verification

The packaged Apple silicon app was run from outside the checkout with disposable data. Checks covered first-run setup, code copying, draft autosave and reload, attempt completion, quit/reopen persistence, graceful server shutdown, and native JSON export. The exported records were restored into a separate empty workspace and every table matched. Startup ownership/crash recovery tests, the production server smoke check, lint and typecheck also passed. Public download installation and the GitHub build workflow still need verification once released.
