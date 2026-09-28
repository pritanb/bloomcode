# BloomCode

A local-first app for learning data structures and algorithms through LeetCode practice. BloomCode combines spaced repetition with optional AI feedback on your solutions and recurring difficulties across attempts.

**Electron · TypeScript · React · Fastify · SQLite · MCP**

[Get started](#get-started) · [Try the demo](#try-the-demo) · [Engineering](#engineering) · [Why BloomCode?](#why-bloomcode)

![Study desk with a daily plan, review calendar and recent practice](docs/screenshots/desktop-study-desk.png)

## What it does

- Plan daily practice and schedule reviews with spaced repetition.
- Save your solutions, results and reflections in one place.
- Get AI feedback on solution correctness, complexity and areas for improvement.
- Review learning reports that connect evidence across saved attempts and suggest targeted practice.

Solve on LeetCode, then save your result in BloomCode. The app stores code; it does not execute it or submit answers to LeetCode.

Your practice history is stored on your computer. Practice tracking and review scheduling work without AI. Enabling the tutor sends selected code and notes to your model provider; embeddings run locally. See [tutor setup](docs/tutor-integration.md) and [Learning Insights](docs/learning-insights.md) for details.

## Get started

**[Download the v0.2.0 preview for Apple silicon Macs](https://github.com/pritanb/bloomcode/releases/tag/v0.2.0)**

Unzip the download, move the app to Applications and open it, then choose your timezone, daily target and a starter list. The application is named **BloomCode.app**.

The app is not yet signed or notarized, so macOS may block it; see [installation](docs/desktop.md). Intel Macs, Windows and Linux are not supported yet.

### Run from source

Install **Node.js 22.23 or later**, clone this repository, then run:

```sh
npm ci
npm run electron:dev
```

This builds the app and opens it in its desktop window. See [building the Electron app](docs/desktop.md#build-from-source) to package your own copy.

## Try the demo

After installing and building, run `npm run demo` and open [localhost:4331](http://127.0.0.1:4331).

Explore 150 questions, sample practice history and example tutor feedback. Edit freely: the demo uses its own temporary database and never opens your workspace. Stop with Ctrl+C; restart for fresh sample data.

## Screenshots

### Practice workspace

Record results, edit code and keep notes together, with automatic draft saving and light/dark themes.

![Dark-mode practice workspace with Python code and notes](docs/screenshots/practice-workspace.jpg)

### Practice history

Compare your attempt notes with tutor feedback side by side.

![Practice history with attempt notes and illustrative tutor feedback in two columns](docs/screenshots/practice-history.png)

Screenshots use sample records. Tutor feedback is illustrative; connecting an AI tutor is optional.

## Engineering

- React and MCP clients share an authenticated Fastify API backed by SQLite. Electron bundles the local server and manages its lifecycle.
- Autosaved drafts, version checks and repeat-safe submissions protect saved work. Daily plans persist across reloads.
- Learning reports use retrieval-augmented generation (RAG) over saved attempts, with local embeddings and hybrid semantic/keyword search. The backend checks citations and recommended question IDs before saving reports.
- Versioned question packs, validated imports and SQLite backups support moving and extending your study records.
- Tests cover critical functions and a browser save/reload flow, with [automated GitHub checks](.github/workflows/checks.yml).

See the [architecture diagrams](docs/architecture/README.md) for the platform and AI tutor flows, and the [backend notes](src/server/README.md) for implementation details.

## Your workspace

Data is stored outside the repository:

- **macOS:** `~/Library/Application Support/BloomCode/`
- **Linux:** `~/.local/share/bloomcode/` (or under `XDG_DATA_HOME`)
- **Windows:** `%LOCALAPPDATA%\BloomCode\`

Workspaces from before the BloomCode rename (`LeetCodeTutor`, `leetcode-tutor` or macOS `LeetcodeTutor-dev`) keep their location. To use a different data directory or port for the scripts and MCP adapter, copy [.env.example](.env.example) to `.env`; the app and integrations must match.

The app backs up once a day at startup; run `npm run backup` while it is running for an extra copy. See [Operations](docs/operations.md) for restoring.

## Documentation

- [Question packs and extensions](docs/extensions.md) — add your own lists or integrations.
- [Learning Insights](docs/learning-insights.md) — local semantic retrieval, evidence-backed learning patterns, and optional practice suggestions.
- [Optional AI tutor](docs/tutor-integration.md) — automatic reports through the Python AI layer and Codex SDK, plus MCP tools for chatting with a tutor about your study data.
- [Contributing](CONTRIBUTING.md) · [Testing](docs/testing.md)

## Why BloomCode?

I built BloomCode because completing more LeetCode questions wasn't helping me understand data structures and algorithms as well as I'd hoped. I wanted a way to revisit earlier work, see where I kept getting stuck and use that feedback to guide my practice.

The name is a nod to Benjamin Bloom's work on [mastery learning](https://en.wikipedia.org/wiki/Mastery_learning). His emphasis on feedback and further practice fits what I wanted the app to support.

## License

BloomCode's original source code is available under the [MIT License](LICENSE).

Third-party components and bundled data retain their own licenses and terms. See [third-party notices](docs/licenses/) and [bundled data provenance](src/integrations/manifests/README.md).
