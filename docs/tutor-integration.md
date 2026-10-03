# Connect an optional tutor

Practice, saving, scoring and scheduling work without a model. A tutor adds written feedback.

To chat with a tutor about your study data, start the app and add the MCP adapter to your MCP client (use your own absolute paths):

```json
{
  "mcpServers": {
    "bloomcode": {
      "command": "node",
      "args": ["/absolute/path/to/bloomcode/dist/server/mcp.js"],
      "env": {
        "DATA_DIR": "/absolute/path/to/your/workspace",
        "PORT": "4317"
      }
    }
  }
}
```

The surrounding format varies by client. If Node is not on the client's PATH, use its absolute path. No credential belongs here: the adapter reads the app's `api-token` file, so it must run as your user. It does not load `.env`.

The adapter only provides tools; it runs no background work. Ask your tutor to review a finished attempt with `get_attempt_context` and `save_review`. `tools/list` describes the required versions and idempotency keys.

## Choose who runs the tutor

**Settings → AI tutor** chooses who generates tutor reports, Learning Insights and topic picks:

- **Codex (your ChatGPT plan)**: the app sends tasks to its Python AI layer, which uses the signed-in Codex SDK. No MCP client needs to be open. **Test Codex** checks the setup.
- **Claude Code (your Claude plan)**: the same Python AI layer uses the Claude Agent SDK with your signed-in Claude Code CLI. **Test Claude Code** checks the setup.
- **Off**: the default, so no plan usage is spent until you choose a provider. Jobs stay queued and saved work is unaffected.

The MCP tools work with either setting. An older workspace saved with the removed MCP-sampling provider loads as **Off**.

### Codex

- **Detection**: the app looks for the Codex CLI bundled in ChatGPT.app first, then `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. Older standalone CLIs may reject newer models for ChatGPT accounts. You can set the path under **Advanced**; it must end in `codex`.
- **Python setup**: install the dependencies in [python/README.md](../python/README.md). All LLM features require Python and file-based Codex sign-in. Keyring-only sign-in is not supported. **Test Codex** checks this same runtime.
- **Isolation**: each background job uses an isolated temporary Codex configuration, an empty workspace, a read-only sandbox and disabled model tools. Python owns prompts and structured generation. Only task data crosses the host bridge; Fastify validates results before saving. Conversations use their separate persistent runtime.
- **Defaults**: model `gpt-6-luna`. Reasoning effort is high for tutor reports, attempt analysis and topic picks, and xhigh for the learning report. All of these can be changed under **Advanced**.
- **Usage**: usage counts toward your ChatGPT plan limits. After a usage-limit, sign-in, missing-install or unavailable-model error, the app pauses and shows the reason instead of failing every queued job. Saving the settings or a successful test resumes work.
- **Privacy**: saved code, notes and problem metadata for each job go to OpenAI.

### Claude Code

- **Detection**: the app looks for the Claude Code CLI in `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`, and otherwise uses the CLI bundled with the Python `claude-agent-sdk` package. You can set the path under **Advanced**; it must end in `claude`.
- **Sign-in**: run `claude auth login` once in a terminal. The standalone CLI has its own login, separate from Claude Code in the Claude desktop app. Jobs always use this plan login: `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from the AI worker's environment, so a stray key never switches to pay-per-request billing.
- **Isolation**: each background job runs with no built-in tools, no MCP servers, no user or project settings, safe mode (no CLAUDE.md, skills, plugins or hooks), no saved session and an empty temporary workspace. The prompt replaces Claude Code's system prompt, and the output is constrained to the task's JSON schema.
- **Defaults**: model `opus` (the CLI's alias for the latest Opus). Reasoning effort uses the same per-job settings as Codex. The CLI also makes a small Haiku call per run.
- **Usage**: usage counts toward your Claude plan limits, with the same pause-and-resume behaviour as Codex.
- **Bloom chat**: with Claude Code selected, Ask Bloom and coaching also run on Claude Code (otherwise they use Codex). The chat keeps its session under `~/.claude/projects/` so conversations resume, and connects only the BloomCode MCP server with the same nine read and propose tools as Codex; every other BloomCode tool is hidden and denied. Safe mode is off for chat because it would disable that server; user settings, CLAUDE.md, hooks, plugins, skills and built-in tools stay off. Switching provider starts a new conversation.
- **Privacy**: saved code, notes and problem metadata for each job go to Anthropic.

Settings are stored in `tutor-settings.json` beside the database. They are machine-specific and not included in backups.

## Automatic reports

With a provider selected, a report sends the submitted code, notes, problem metadata and recent attempt summaries to it, and saves the result through the normal review rules. Submitted code is never run.

With the tutor off or paused, attempts still save normally and you can request feedback later. The report queue is not persisted, so request a report again after restarting the app. BloomCode never changes your MCP client's configuration.

## Learning Insights

The selected provider also analyzes learning evidence across completed attempts. Enable **Learning insights** in the app to download local embeddings and queue history. Immediate attempt reports take priority. See [Learning Insights](learning-insights.md) for privacy, evaluation, the two additional MCP tools, and restart/retry behavior.
