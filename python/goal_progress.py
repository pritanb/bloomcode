"""Facts about practice since agreement, not an automatic verdict on a goal."""

from collections import Counter
from datetime import datetime


def timestamp(value):
    if not isinstance(value, str) or "T" not in value:
        return None  # Imported date-only records do not establish a start time.
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def goal_progress(goal: dict, data: dict) -> dict:
    agreed = timestamp(goal["createdAt"])
    if agreed is None:
        return {"goalId": goal["id"], "status": "unavailable"}
    attempts = []
    uncertain_dates = 0
    for row in data["attempts"][:20]:
        started, finished = timestamp(row.get("startedAt")), timestamp(row.get("finishedAt"))
        if started is None or finished is None or finished < started:
            uncertain_dates += 1
            continue
        if started < agreed:
            continue
        attempts.append({
            "id": row["id"], "problemId": row["problem"]["id"],
            "title": row["problem"]["title"][:200],
            "startedAt": row["startedAt"], "finishedAt": row["finishedAt"],
            "outcome": row["outcome"], "help": row["help"],
        })
    independent = {a["problemId"] for a in attempts if a["outcome"] == "solved" and a["help"] == "none"}
    return {
        "goalId": goal["id"], "status": "available", "since": goal["createdAt"],
        "scope": "practice since agreement; relevance to this goal has not been established",
        "hasMore": data["hasMore"] or len(data["attempts"]) > 20,
        "excludedUncertainDates": uncertain_dates,
        "attemptCount": len(attempts),
        "distinctProblems": len({a["problemId"] for a in attempts}),
        "distinctSolvedWithoutHelp": len(independent),
        "outcomes": dict(Counter(a["outcome"] for a in attempts)),
        "helpUsage": dict(Counter(a["help"] for a in attempts)),
        "attempts": attempts,
    }
