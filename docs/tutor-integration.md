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

- **Codex (your ChatGPT plan)**: the app runs your signed-in Codex CLI for each job. No MCP client needs to be open. **Test Codex** checks the setup.
- **Off**: the default, so no plan usage is spent until you choose Codex. Jobs stay queued and saved work is unaffected.

The MCP tools work with either setting. An older workspace saved with the removed MCP-sampling provider loads as **Off**.

### Codex

- **Detection**: the app looks for the Codex CLI bundled in ChatGPT.app first, then `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. Older standalone CLIs may reject newer models for ChatGPT accounts. You can set the path under **Advanced**; it must end in `codex`.
- **Isolation**: each job runs in an empty temporary directory with a read-only sandbox, with the user configuration ignored (no MCP servers), with shell, browser and other tools disabled, and with no session files. The prompt is sent on stdin. Codex's own instructions are replaced with a short generator instruction, which leaves about 8k tokens of fixed overhead per call. Only the final message is used, and it passes the same validation as every tutor result.
- **Defaults**: model `gpt-6-luna`. Reasoning effort is high for tutor reports, attempt analysis and topic picks, and xhigh for the learning report. All of these can be changed under **Advanced**.
- **Usage**: usage counts toward your ChatGPT plan limits. After a usage-limit, sign-in, missing-install or unavailable-model error, the app pauses and shows the reason instead of failing every queued job. Saving the settings or a successful test resumes work.
- **Privacy**: saved code, notes and problem metadata for each job go to OpenAI.

Settings are stored in `tutor-settings.json` beside the database. They are machine-specific and not included in backups.

## Automatic reports

With Codex selected, a report sends the submitted code, notes, problem metadata and recent attempt summaries to Codex, and saves the result through the normal review rules. Submitted code is never run.

With the tutor off or paused, attempts still save normally and you can request feedback later. The report queue is not persisted, so request a report again after restarting the app. BloomCode never changes your MCP client's configuration.

## Learning Insights

Codex also analyzes learning evidence across completed attempts. Enable **Learning insights** in the app to download local embeddings and queue history. Immediate attempt reports take priority. See [Learning Insights](learning-insights.md) for privacy, evaluation, the two additional MCP tools, and restart/retry behavior.
