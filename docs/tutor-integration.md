# Connect an optional tutor

Practice, saving, scoring and scheduling work without a model. A tutor adds written feedback. Start the app before connecting a client.

A typical MCP client configuration looks like this (replace paths with your own absolute paths):

```json
{
  "mcpServers": {
    "leetcode-tutor": {
      "command": "node",
      "args": ["/absolute/path/to/leetcode-tutor/dist/server/mcp.js"],
      "env": {
        "DATA_DIR": "/absolute/path/to/your/workspace",
        "PORT": "4317",
        "TUTOR_AUTO_REVIEW": "0"
      }
    }
  }
}
```

Client configuration envelopes differ; use your client's MCP settings. On Windows use escaped backslashes or forward slashes in JSON paths. If Node is not on the client's PATH, use its absolute executable path. No credential belongs in this configuration: the adapter reads the app's private `api-token` file locally. It must run as a user who can access that file. A client's working directory is not assumed and `.env` is not loaded by this direct invocation.

The example disables automatic reports. Ask your tutor to review a finished attempt through `get_attempt_context` and `save_review`. The tool schema returned by `tools/list` describes required versions and idempotency keys.

## Choose who runs the tutor

**Settings → AI tutor** chooses who generates tutor reports, Learning Insights and topic picks:

- **Codex (your ChatGPT plan)**: the app runs the signed-in Codex CLI on this Mac for each job. No MCP client needs to be open, and a rebuild takes effect immediately. **Test Codex** checks the setup.
- **Connected MCP client (Hermes)**: the MCP adapter asks the client to run the model through MCP sampling, as described below. Existing workspaces default to this setting.
- **Off**: jobs stay queued and saved work is unaffected.

Only the selected provider receives work, so switching never processes a job twice. The MCP tools in the previous section work with every setting.

### Codex

- **Detection**: the app looks for the Codex CLI bundled in ChatGPT.app first, then `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. Older standalone CLIs may reject newer models for ChatGPT accounts. You can set the path under **Advanced**; it must end in `codex`.
- **Isolation**: each job runs in an empty temporary directory with a read-only sandbox, with the user configuration ignored (no MCP servers), with shell, browser and other tools disabled, and with no session files. The prompt is sent on stdin. Codex's own instructions are replaced with a short generator instruction, which leaves about 8k tokens of fixed overhead per call. Only the final message is used, and it passes the same validation as sampling results.
- **Defaults**: model `gpt-6-luna`. Reasoning effort is high for tutor reports, attempt analysis and topic picks, and xhigh for the learning report. All of these can be changed under **Advanced**.
- **Usage**: usage counts toward your ChatGPT plan limits. After a usage-limit, sign-in, missing-install or unavailable-model error, the app pauses and shows the reason instead of failing every queued job. Saving the settings or a successful test resumes work.
- **Privacy**: the same saved code, notes and metadata go to OpenAI as with the Hermes `openai-codex` provider.

Settings are stored in `tutor-settings.json` beside the database. This machine-specific file is not part of portable exports.

## Automatic reports

For a client that advertises MCP sampling, omit `TUTOR_AUTO_REVIEW` or set it to `1` to enable polling for requested reports. Existing sampling-capable integrations retain their behavior. `TUTOR_AUTO_REVIEW=0` disables background sampling without disabling the tools. Clients without sampling never start the background reviewer.

A report sends the submitted code, notes, problem metadata and recent attempt summaries to the connected client's model. Review that client's provider and data settings before enabling it; the app does not select a provider or supply a key. The generated report is saved through the normal authenticated review endpoint. It does not execute or test submitted code.

If no client is connected, an attempt still saves normally. You can keep practising and request feedback later. The report queue is transient; after restarting the app, request a report again if necessary. Hermes is one possible client, not a required dependency, and this app never changes a client's configuration automatically.

## Learning Insights

The same sampling connection can analyze learning evidence across completed attempts. Enable **Learning insights** in the app to download local embeddings and queue history. Immediate attempt reports take priority. See [Learning Insights](learning-insights.md) for privacy, evaluation, the four additional MCP tools, and restart/retry behavior.
