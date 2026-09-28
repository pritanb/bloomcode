"""Build a small factual snapshot using BloomCode's existing MCP server."""

import asyncio
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import tomllib

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from tutor.goal_progress import goal_progress


def summarize_attempts(data: dict) -> dict:
    # Retain only the fields needed for recommendations, never code or notes.
    attempts = [
        {
            "id": row["id"],
            "problemId": row["problem"]["id"],
            "title": row["problem"]["title"][:200],
            "finishedAt": row["finishedAt"],
            "outcome": row["outcome"],
            "help": row["help"],
        }
        for row in data["attempts"][:10]
    ]
    return {
        "status": "available",
        "scope": "latest completed attempts, not the entire study history",
        "hasMore": data["hasMore"] or len(data["attempts"]) > 10,
        "attemptCount": len(attempts),
        "distinctProblems": len({a["problemId"] for a in attempts}),
        "outcomes": dict(Counter(a["outcome"] for a in attempts)),
        "helpUsage": dict(Counter(a["help"] for a in attempts)),
        "attempts": attempts,
    }


@asynccontextmanager
async def platform_session(config_file: Path, data_dir: Path | None = None):
    config = tomllib.loads(config_file.read_text())["mcp_servers"]["bloomcode"]
    env = dict(config["env"])
    if data_dir is not None:
        env["DATA_DIR"] = str(data_dir)
    server = StdioServerParameters(
        command=config["command"], args=config["args"],
        cwd=config["cwd"], env=env,
    )
    async with asyncio.timeout(30):
        async with stdio_client(server) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                yield session


async def _read_snapshot(config_file: Path) -> dict:
    async with platform_session(config_file) as session:
        result = await session.call_tool("get_recent_attempts", {"limit": 10})
        data = json.loads(result.content[0].text)
        if result.isError:
            error = data["error"]
            return {"status": "blocked" if error.get("status") == 403 else "unavailable"}
        snapshot = summarize_attempts(data)
        result = await session.call_tool("get_tutor_preferences", {})
        data = json.loads(result.content[0].text)
        if result.isError:
            if data["error"].get("status") == 403:
                return {"status": "blocked"}
            snapshot["preferences"] = {"status": "unavailable"}
        else:
            snapshot["preferences"] = {"status": "available", **data}
        result = await session.call_tool("get_topic_scores", {"limit": 20})
        data = json.loads(result.content[0].text)
        if result.isError:
            # Access may have changed since the first read. Drop all
            # records if a mixed assessment has started in between.
            if data["error"].get("status") == 403:
                return {"status": "blocked"}
            snapshot["topicScores"] = {"status": "unavailable"}
        else:
            snapshot["topicScores"] = {"status": "available", **data}
        result = await session.call_tool("get_learning_goals", {})
        data = json.loads(result.content[0].text)
        if result.isError:
            if data["error"].get("status") == 403:
                return {"status": "blocked"}
            snapshot["goals"] = {"status": "unavailable"}
        else:
            snapshot["goals"] = {"status": "available", **data}
            # Bound both API calls and context size. Other active goals remain
            # visible, but have no computed progress in this snapshot.
            snapshot["goalProgress"] = []
            snapshot["goalProgressHasMore"] = len(data["goals"]) > 3 or data["hasMore"]
            for goal in data["goals"][:3]:
                result = await session.call_tool("get_recent_attempts", {
                    "startedAfter": goal["createdAt"], "limit": 20,
                })
                evidence = json.loads(result.content[0].text)
                if result.isError:
                    if evidence["error"].get("status") == 403:
                        return {"status": "blocked"}
                    progress = {"goalId": goal["id"], "status": "unavailable"}
                else:
                    progress = goal_progress(goal, evidence)
                snapshot["goalProgress"].append(progress)
        return snapshot


def load_snapshot(config_file: Path) -> dict:
    try:
        snapshot = asyncio.run(_read_snapshot(config_file))
    except Exception:
        # A transport failure is not an empty history. Never echo raw credentials
        # or adapter output into the conversation.
        snapshot = {"status": "unavailable"}
    return {"retrievedAt": datetime.now(timezone.utc).isoformat(), **snapshot}


async def save_confirmed_change(config_file: Path, host_data: Path, change: dict,
                              conversation: str, key: str, *, tool: str) -> dict:
    async with platform_session(config_file, host_data) as session:
        result = await session.call_tool(tool, {
            "change": change, "sourceConversation": conversation, "idempotencyKey": key,
        })
        if result.isError:
            raise RuntimeError("Change was not confirmed. Retry /confirm; if the record changed, request a fresh proposal.")
        return json.loads(result.content[0].text)
