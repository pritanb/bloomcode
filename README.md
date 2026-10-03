<div align="center">

# BloomCode

**Practise deliberately. Understand your mistakes. Build lasting DSA knowledge.**

A local-first desktop app that combines structured LeetCode practice, spaced repetition, and an AI coding tutor that uses your recorded work.

[Get started](#get-started) · [Meet Bloom](#meet-bloom-your-ai-coding-tutor) · [Architecture](#architecture) · [Documentation](#documentation)

**Electron · React · TypeScript · Python · LangGraph · Codex SDK · SQLite · MCP**

</div>

![BloomCode study desk with a daily plan, review calendar and recent practice](docs/screenshots/desktop-study-desk.png)

## Why BloomCode?

Finishing a question doesn't necessarily mean you can solve it again—or explain why the solution works. BloomCode helps you turn individual attempts into a practice routine: save your reasoning, revisit earlier problems, and use evidence from your work to decide what to practise next.

Solve on LeetCode, then record your result in BloomCode. The app stores your code and reflections; it does not execute solutions or submit answers to LeetCode.

## Features

|                        | What you can do                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Daily practice**     | Bloom plans each day at your level in each topic, and brings ideas back as new problems instead of repeats.            |
| **Practice workspace** | Save code, notes, outcomes, help usage, and reflections with automatic draft saving.                                   |
| **Progress tracking**  | Follow topic scores, compare previous attempts, and revisit mistake and pattern notebooks.                             |
| **Bloom AI tutor**     | Discuss your work from anywhere in the app, get guided coaching, and resume conversations.                             |
| **Learning Insights**  | Identify supported learning patterns and turn them into targeted exercises with success checks.                        |
| **Your own workspace** | Keep study records in local SQLite, use native backups, and extend the question library with imported lists and packs. |

## Meet Bloom, your AI coding tutor

Bloom is a movable companion available throughout the app. It uses your saved attempts, reflections, topic scores, goals, and preferences to provide context-aware guidance.

### Conversations grounded in your work

Ask “Why am I struggling with binary search?” or “What should I practise next?” Bloom searches related learning observations, inspects supporting attempts, and considers counterexamples before answering. Evidence links let you open the records behind its advice.

Conversations persist locally, so you can return to an earlier discussion. Learning goals and teaching preferences are saved only after you confirm them.

### Guided coaching

Start coaching on a completed attempt to work through one idea at a time. Bloom can ask a diagnostic question, offer a hint, or explain a concept in response to your answer. LangGraph manages the teaching flow and checkpoints, allowing coaching to pause and resume.

### Targeted Learning Insights

Insights connect evidence across attempts and provide:

- **A specific focus:** the decision or concept supported by the records.
- **Your evidence:** relevant excerpts and links to completed attempts.
- **An action and exercise:** a concrete way to practise that skill.
- **A success check:** what you should be able to explain or demonstrate.

The system distinguishes repeated attempts at one problem from difficulties across different problems. You can inspect and correct observations; sparse or conflicting evidence should be acknowledged rather than turned into a confident diagnosis.

### Feedback and practice priorities

After an attempt, get feedback on your submitted solution, complexity, and areas to improve. Topic recommendations use recorded scores, recent outcomes, help usage, and score movements to suggest where to focus.

Bloom also plans each day. Every LeetCode problem has a rating, and each topic has a level that rises or falls with your results (time, help, first-try acceptance and confidence). Bloom picks popular problems near your level, weakest topics first. Instead of repeating a problem you solved, it later checks the idea with a different problem and hides the topic, so you practise spotting the approach rather than recalling a solution.

**AI is optional.** Practice tracking, saving, scoring, and scheduling work without it. AI feedback can be incomplete or mistaken, and source verification does not prove that a diagnosis is correct.

## Get started

### Run the current source

For the desktop app, use macOS with **Node.js 22.23 or later** and Apple's Command Line Tools. Clone the repository and run:

```sh
git clone https://github.com/pritanb/bloomcode.git
cd bloomcode
npm ci
npm run electron:dev
```

This builds the backend and opens Electron with live UI updates. Restart the command after changing backend or Python worker code. See [desktop development](docs/desktop.md#develop-with-live-ui-updates) or the [browser-only development workflow](CONTRIBUTING.md#development).

### Enable the AI features

Install **Python 3.11+** and the AI dependencies from the repository root:

```sh
python3 -m venv python/.venv
python/.venv/bin/python -m pip install -r python/requirements.txt
```

Use an existing **file-based Codex sign-in**, then restart BloomCode:

1. Click **Ask Bloom** to open the conversational tutor.
2. Choose **Settings → AI tutor → Codex** and use **Test Codex** to check background analysis setup.
3. Enable **Learning Insights** to analyse your saved attempts.

The runtime currently requires `CODEX_HOME/auth.json` (normally `~/.codex/auth.json`); keyring-only sign-in is not supported. Selected study context is sent to Codex and uses your signed-in account's allowance. Set `BLOOMCODE_PYTHON` to an absolute interpreter path if you use a different environment.

See the [Python AI guide](python/README.md) for terminal chat, configuration, and troubleshooting.

### Download the desktop preview

An [Apple silicon macOS preview (v0.5.0)](https://github.com/pritanb/bloomcode/releases/tag/v0.5.0) is available. Unzip it, move **BloomCode.app** to Applications, and follow [installation instructions](docs/desktop.md).

The preview includes the AI workflows; follow the [one-time Python setup](docs/desktop.md#optional-ai-setup) to enable them. The Python interpreter is installed separately. The app is not signed or notarized, and packaged builds currently target Apple silicon Macs.

### Explore sample data

```sh
npm run build
npm run demo
```

Open [localhost:4331](http://127.0.0.1:4331) to explore 150 questions, sample practice history, and illustrative tutor feedback. The demo uses a temporary database. Stop with Ctrl+C; restart for fresh sample data.

## A closer look

### Practice workspace

Record results, edit code, and keep notes together, with autosaved drafts and light/dark themes.

![Dark-mode practice workspace with Python code and notes](docs/screenshots/practice-workspace.jpg)

<details>
<summary><strong>View practice history</strong></summary>

Compare your notes with tutor feedback and revisit the reasoning behind earlier attempts.

![Practice history with notes and illustrative tutor feedback side by side](docs/screenshots/practice-history.png)

</details>

Screenshots use sample records. Tutor feedback shown in them is illustrative.

## Architecture

**Python owns LLM behavior. Fastify owns authoritative study data.**

| Layer                     | Responsibility                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **React + Electron**      | Desktop interface, practice workspace, and app-wide Bloom chat.                        |
| **Fastify + SQLite**      | Authenticated APIs, job scheduling, permissions, validation, and persistence.          |
| **Python AI layer**       | All application LLM prompts, model calls, structured responses, and feature workflows. |
| **LangGraph**             | Evidence preparation, report generation, and resumable coaching flows.                 |
| **Codex SDK**             | Model interaction, streamed answers, and the conversational tool loop.                 |
| **MCP + local retrieval** | Shared platform tools, local embeddings, and hybrid semantic/keyword search.           |

Bloom, attempt reviews, evidence extraction, Learning Insights, and topic recommendations share the Python AI infrastructure. Simple tasks use a single structured model call; multi-step workflows use LangGraph. Backend validation checks references and access before saving AI results.

![Shared Python AI layer with feature workflows, Codex model access, and backend-controlled study data](docs/architecture/shared-ai.png)

Explore the [architecture diagrams and editable draw.io source](docs/architecture/README.md), [Python code map](python/README.md#code-map), and [backend notes](src/server/README.md).

## Data and privacy

- **Local study records:** your workspace lives outside the repository, normally at `~/Library/Application Support/BloomCode/` on macOS.
- **Optional remote inference:** enabling AI sends selected code, notes, and study context to Codex. Local-first does not mean the LLM runs offline.
- **Local retrieval:** embedding generation and the search index stay on your computer.
- **Backups:** the app creates native SQLite backups daily at startup. Run `npm run backup` while the app is running for an additional copy.
- **Separate conversation storage:** Bloom's conversation history and coaching checkpoints are not included in the study database backup.

Existing workspaces from before the BloomCode rename retain their locations. See [Operations](docs/operations.md) for data locations and restore instructions, and [.env.example](.env.example) for script and MCP configuration.

## Development and validation

```sh
npm run typecheck
npm test
python/.venv/bin/python -m unittest discover -s python/tests -t python -p 'test_*.py'
```

Tests focus on saved work, scoring, scheduling, authentication, AI result validation, and worker lifecycle. Browser checks use disposable workspaces; never use your real study history for QA.

AI evaluations are separate from ordinary tests. For example, `npm run eval:insights:reports` lists the synthetic comparison scenarios; adding `--live` explicitly runs before/after model evaluations and spends Codex usage.

Read [Contributing](CONTRIBUTING.md) and the [testing guide](docs/testing.md) for development commands, browser checks, and verification scope.

## Documentation

| Guide                                               | Contents                                                        |
| --------------------------------------------------- | --------------------------------------------------------------- |
| [Desktop app](docs/desktop.md)                      | Installation, development, and packaging.                       |
| [Python AI layer](python/README.md)                 | Setup, feature workflows, code map, and evaluations.            |
| [Tutor integration](docs/tutor-integration.md)      | Codex configuration and external MCP clients.                   |
| [Learning Insights](docs/learning-insights.md)      | Evidence, local retrieval, corrections, and analysis lifecycle. |
| [Architecture](docs/architecture/README.md)         | Platform and AI diagrams with editable source.                  |
| [Question packs and extensions](docs/extensions.md) | Custom lists, data packs, and integrations.                     |
| [Operations](docs/operations.md)                    | Workspaces, backups, and restoring data.                        |

## About the project

I built BloomCode because completing more LeetCode questions wasn't helping me understand data structures and algorithms as well as I'd hoped. I wanted a way to revisit earlier work, see where I kept getting stuck, and use that feedback to guide my practice.

The name is a nod to Benjamin Bloom's work on [mastery learning](https://en.wikipedia.org/wiki/Mastery_learning), with its emphasis on feedback and further practice.

## License

BloomCode's original source code is available under the [MIT License](LICENSE). Third-party components and bundled data retain their own licenses and terms; see [third-party notices](docs/licenses/) and [bundled data provenance](src/integrations/manifests/README.md).
