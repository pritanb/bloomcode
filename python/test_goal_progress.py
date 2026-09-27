import unittest

from goal_progress import goal_progress


GOAL = {"id": "goal", "createdAt": "2026-09-20T12:00:00Z"}


def attempt(id, problem="a", started="2026-09-21T12:00:00Z", help="none", outcome="solved"):
    return {"id": id, "problem": {"id": problem, "title": problem},
            "startedAt": started, "finishedAt": "2026-09-22T12:00:00Z",
            "help": help, "outcome": outcome}


class GoalProgressTests(unittest.TestCase):
    def test_repeated_attempts_count_as_one_problem(self):
        result = goal_progress(GOAL, {"attempts": [attempt("1"), attempt("2")], "hasMore": False})
        self.assertEqual(result["attemptCount"], 2)
        self.assertEqual(result["distinctProblems"], 1)
        self.assertEqual(result["distinctSolvedWithoutHelp"], 1)
        self.assertNotIn("completed", result)

    def test_earlier_starts_do_not_count_even_if_finished_later(self):
        result = goal_progress(GOAL, {"attempts": [attempt("1", started="2026-09-19T12:00:00Z"),
            attempt("2", started="2026-09-20T22:00:00+10:00")], "hasMore": False})
        self.assertEqual([a["id"] for a in result["attempts"]], ["2"])

    def test_only_solved_without_help_counts_as_independent(self):
        result = goal_progress(GOAL, {"attempts": [attempt("1", "a", help="unknown"),
            attempt("2", "b", outcome="not_solved"), attempt("3", "c")], "hasMore": False})
        self.assertEqual(result["distinctProblems"], 3)
        self.assertEqual(result["distinctSolvedWithoutHelp"], 1)
        self.assertEqual(result["helpUsage"]["unknown"], 1)

    def test_uncertain_dates_and_truncation_are_explicit(self):
        result = goal_progress(GOAL, {"attempts": [attempt("1", started="2026-09-21"),
            attempt("2", started="bad")], "hasMore": True})
        self.assertEqual(result["excludedUncertainDates"], 2)
        self.assertEqual(result["attemptCount"], 0)
        self.assertTrue(result["hasMore"])
        bounded = goal_progress(GOAL, {"attempts": [attempt(str(i)) for i in range(21)], "hasMore": False})
        self.assertEqual(bounded["attemptCount"], 20)
        self.assertTrue(bounded["hasMore"])


if __name__ == "__main__":
    unittest.main()
