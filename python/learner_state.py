"""Build a small factual snapshot using BloomCode's existing MCP server."""

import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import tomllib

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


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


async def _read_snapshot(config_file: Path) -> dict:
    config = tomllib.loads(config_file.read_text())["mcp_servers"]["bloomcode"]
    server = StdioServerParameters(
        command=config["command"], args=config["args"],
        cwd=config["cwd"], env=config["env"],
    )
    async with asyncio.timeout(20):
        async with stdio_client(server) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                result = await session.call_tool("get_recent_attempts", {"limit": 10})
                data = json.loads(result.content[0].text)
                if result.isError:
                    error = data["error"]
                    return {"status": "blocked" if error.get("status") == 403 else "unavailable"}
                return summarize_attempts(data)


def load_snapshot(config_file: Path) -> dict:
    try:
        snapshot = asyncio.run(_read_snapshot(config_file))
    except Exception:
        # A transport failure is not an empty history. Never echo raw credentials
        # or adapter output into the conversation.
        snapshot = {"status": "unavailable"}
    return {"retrievedAt": datetime.now(timezone.utc).isoformat(), **snapshot}
