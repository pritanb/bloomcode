"""Checks for the facts the tutor relies on; no model or real study data."""

from pathlib import Path
import unittest

from tutor.learner_state import load_snapshot, summarize_attempts


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

    def test_unavailable_is_not_empty_history(self):
        state = load_snapshot(Path("/nonexistent-bloomcode-test/config.toml"))
        self.assertEqual(state["status"], "unavailable")
        self.assertNotIn("attemptCount", state)


if __name__ == "__main__":
    unittest.main()
