"""Build a small factual snapshot using BloomCode's existing MCP server."""

import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

from ai_core.platform import platform_session
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



def summarize_levels(data: dict) -> dict:
    return {
        "status": "available",
        "target": data["target"],
        "topics": [
            {"topic": l["topic"], "level": l["level"], "atTarget": l["atTarget"],
             "attempts": l["attempts"],
             "lastChange": l["lastChange"] and {
                 "delta": l["lastChange"]["delta"], "problem": l["lastChange"]["problem"][:200],
                 "rating": l["lastChange"]["rating"], "estimated": l["lastChange"]["estimated"],
                 "result": l["lastChange"]["result"]}}
            for l in data["levels"]
        ],
    }


def summarize_plan(data: dict) -> dict:
    plan = data["plan"]
    return {
        "status": "available",
        "questionsPerDay": data["questionsPerDay"],
        "date": plan["date"] if plan else None,
        "items": [
            {"title": i["title"][:200], "status": i["status"], "reason": i["reason"][:300],
             "started": bool(i["attemptId"]) or i["status"] in {"completed", "skipped"}}
            for i in (plan["items"] if plan else [])
        ],
    }


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
        result = await session.call_tool("get_training_levels", {})
        data = json.loads(result.content[0].text)
        if result.isError:
            if data["error"].get("status") == 403:
                return {"status": "blocked"}
            snapshot["trainingLevels"] = {"status": "unavailable"}
        else:
            snapshot["trainingLevels"] = summarize_levels(data)
        result = await session.call_tool("get_today_plan", {})
        data = json.loads(result.content[0].text)
        if result.isError:
            if data["error"].get("status") == 403:
                return {"status": "blocked"}
            snapshot["todayPlan"] = {"status": "unavailable"}
        else:
            snapshot["todayPlan"] = summarize_plan(data)
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
