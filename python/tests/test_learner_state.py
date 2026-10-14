"""Checks for the facts the tutor relies on; no model or real study data."""

from contextlib import asynccontextmanager
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tutor.learner_state import load_snapshot, summarize_attempts


def platform(**overrides):
    """A fake BloomCode MCP session: empty study records, with per-tool overrides."""
    replies = {
        "get_recent_attempts": {"attempts": [], "hasMore": False},
        "get_tutor_preferences": {"explanationDepth": "concise", "hintStyle": "direct", "version": 1},
        "get_topic_scores": {"topics": []},
        "get_training_levels": {"target": 1850, "levels": []},
        "get_today_plan": {"plan": None, "questionsPerDay": 3},
        "get_tutor_notes": {"notes": [], "total": 0, "hasMore": False},
        "get_learning_goals": {"goals": [], "hasMore": False},
        **overrides,
    }
    async def call_tool(name, args):
        reply = replies[name]
        error = isinstance(reply, int)
        text = json.dumps({"error": {"status": reply}} if error else reply)
        return SimpleNamespace(content=[SimpleNamespace(text=text)], isError=error)
    @asynccontextmanager
    async def session(config):
        yield SimpleNamespace(call_tool=call_tool)
    return patch("tutor.learner_state.platform_session", session)


def attempt(id, problem, help="none"):
    return {"id": id, "problem": {"id": problem, "title": problem},
            "finishedAt": "2026-09-27T00:00:00Z", "outcome": "solved",
            "help": help, "notes": "Do not include this", "code": "private code"}


class LearnerStateTests(unittest.TestCase):
    def test_repeats_unknown_help_and_data_minimization(self):
        state = summarize_attempts({"attempts": [attempt("1", "a"),
            attempt("2", "a", "unknown"), attempt("3", "b", "major")], "hasMore": False})
        self.assertEqual(state["attemptCount"], 3)
        self.assertEqual(state["distinctProblems"], 2)
        self.assertEqual(state["helpUsage"], {"none": 1, "unknown": 1, "major": 1})
        self.assertEqual(state["outcomes"], {"solved": 3})
        self.assertNotIn("notes", state["attempts"][0])
        self.assertNotIn("code", state["attempts"][0])

    def test_bounded_sample_and_empty_history(self):
        state = summarize_attempts({"attempts": [attempt(str(i), str(i)) for i in range(11)], "hasMore": False})
        self.assertEqual(state["attemptCount"], 10)
        self.assertTrue(state["hasMore"])
        empty = summarize_attempts({"attempts": [], "hasMore": False})
        self.assertEqual(empty["status"], "available")
        self.assertEqual(empty["distinctProblems"], 0)

    def test_confirmed_lessons_reach_the_snapshot_and_assessments_hide_everything(self):
        lessons = {"notes": [{"id": "n1", "text": "Say when a trie is optional.", "topic": "Tries",
                              "version": 0}], "total": 1, "hasMore": False}
        with platform(get_tutor_notes=lessons):
            state = load_snapshot(Path("config.toml"))
        self.assertEqual(state["tutorNotes"], {"status": "available", **lessons})
        with platform(get_tutor_notes=403):
            self.assertEqual(load_snapshot(Path("config.toml"))["status"], "blocked")
        with platform(get_tutor_notes=500):
            self.assertEqual(load_snapshot(Path("config.toml"))["tutorNotes"], {"status": "unavailable"})

    def test_unavailable_is_not_empty_history(self):
        state = load_snapshot(Path("/nonexistent-bloomcode-test/config.toml"))
        self.assertEqual(state["status"], "unavailable")
        self.assertNotIn("attemptCount", state)


if __name__ == "__main__":
    unittest.main()
