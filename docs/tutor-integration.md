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

## Automatic reports

For a client that advertises MCP sampling, omit `TUTOR_AUTO_REVIEW` or set it to `1` to enable polling for requested reports. Existing sampling-capable integrations retain their behavior. `TUTOR_AUTO_REVIEW=0` disables background sampling without disabling the six tools. Clients without sampling never start the background reviewer.

A report sends the submitted code, notes, problem metadata and recent attempt summaries to the connected client's model. Review that client's provider and data settings before enabling it; the app does not select a provider or supply a key. The generated report is saved through the normal authenticated review endpoint. It does not execute or test submitted code.

If no client is connected, an attempt still saves normally. You can keep practising and request feedback later. The report queue is transient; after restarting the app, request a report again if necessary. Hermes is one possible client, not a required dependency, and this app never changes a client's configuration automatically.
