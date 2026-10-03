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

**Settings → AI tutor** chooses who generates tutor reports, Learning Insights, topic picks and today's plan:

- **Codex (your ChatGPT plan)**: the app sends tasks to its Python AI layer, which uses the signed-in Codex SDK. No MCP client needs to be open. **Test Codex** checks the setup.
- **Off**: the default, so no plan usage is spent until you choose Codex. Jobs stay queued and saved work is unaffected.

The MCP tools work with either setting. An older workspace saved with the removed MCP-sampling provider loads as **Off**.

### Codex

- **Detection**: the app looks for the Codex CLI bundled in ChatGPT.app first, then `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. Older standalone CLIs may reject newer models for ChatGPT accounts. You can set the path under **Advanced**; it must end in `codex`.
- **Python setup**: install the dependencies in [python/README.md](../python/README.md). All LLM features require Python and file-based Codex sign-in. Keyring-only sign-in is not supported. **Test Codex** checks this same runtime.
- **Isolation**: each background job uses an isolated temporary Codex configuration, an empty workspace, a read-only sandbox and disabled model tools. Python owns prompts and structured generation. Only task data crosses the host bridge; Fastify validates results before saving. Conversations use their separate persistent runtime.
- **Defaults**: model `gpt-6-luna`. Reasoning effort is high for tutor reports, attempt analysis and topic picks, and xhigh for the learning report. All of these can be changed under **Advanced**.
- **Usage**: usage counts toward your ChatGPT plan limits. After a usage-limit, sign-in, missing-install or unavailable-model error, the app pauses and shows the reason instead of failing every queued job. Saving the settings or a successful test resumes work.
- **Privacy**: saved code, notes and problem metadata for each job go to OpenAI.

Settings are stored in `tutor-settings.json` beside the database. They are machine-specific and not included in backups.

## Automatic reports

With Codex selected, a report sends the submitted code, notes, problem metadata and recent attempt summaries to Codex, and saves the result through the normal review rules. Submitted code is never run.

With the tutor off or paused, attempts still save normally and you can request feedback later. The report queue is not persisted, so request a report again after restarting the app. BloomCode never changes your MCP client's configuration.

## Today's plan

Bloom decides each day's questions; with the tutor off, paused or failing, simple built-in rules do instead. Lists never drive the plan.

**Ratings.** Every LeetCode algorithm problem has a rating on one scale: contest problems use [zerotrac's contest ratings](https://github.com/zerotrac/leetcode_problem_rating) (MIT, pinned in `src/integrations/manifests/`); the rest use an estimate fitted from difficulty, acceptance rate and topic tags (about ±150, shown as "≈"). Popularity is the LeetCode likes percentile, a proxy for how often a problem comes up in interviews. Download the **LeetCode problem bank** during setup or in **Settings → Which questions**; it fetches LeetCode's public problem list on your machine and imports every algorithm problem rated up to 2,000.

**Levels.** Each finished attempt is **Strong** (solved alone, on time — Easy 15, Medium 25, Hard 40 minutes — accepted first try, confidence 4–5), **Struggled** (not solved, major help or the solution, or confidence 1–2) or **OK** (anything in between). Unanswered questions don't count against you; "too easy" / "too hard" moves the result one step. Each topic's level moves by an Elo update against the problem's rating, starting at 1,300, toward your **target rating** (default 1,850: the upper range of Mediums in FAANG screens).

**Candidates.** For each topic below target, weakest first: the most popular unseen problems within 100 of your level (or the closest ones), never above the target.

**Spaced repetition of ideas, not problems.** Problems never come back by themselves, because re-solving a remembered problem tests memory, not transfer. On the usual review dates the idea returns instead:

- after a struggle, as easier practice from the same topic;
- otherwise, as a **transfer check**: a different, unseen problem with the same core idea, shown only as "Transfer check — spot the approach yourself". Bloom names same-idea problems (tags are too broad for this); the app accepts the first that is unseen, not much harder than the original and under the target. Starting it from Today hides its tags, and it counts as unseen evidence. If none qualifies, or the tutor is off, the idea comes back as visible practice in the same topic ("Two Pointers · practice after …"): only Bloom can tell which problems share an idea, so nothing else is passed off as a transfer check.

Finishing a check moves the original idea's schedule on; the check problem gets none of its own. Two solo solves of an idea two weeks apart retire it. After a check, Bloom's attempt report names the shared idea.

**Each day.** When Today first opens, Bloom plans in the background (the plan waits for it): goals first, then weak topics and recent struggles, due checks up to about half the day, easier first. Its picks become the plan, with a one-line summary; **Re-plan** asks again for unstarted questions. If Bloom fails, the built-in rules fill the day: due checks, then the weakest topics, one problem each. In chat, Bloom proposes changes from the same candidates — the app refuses anything else — and nothing changes until you confirm.

## Learning Insights

Codex also analyzes learning evidence across completed attempts. Enable **Learning insights** in the app to download local embeddings and queue history. Immediate attempt reports take priority. See [Learning Insights](learning-insights.md) for privacy, evaluation, the two additional MCP tools, and restart/retry behavior.
