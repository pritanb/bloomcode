"""The host confirmation boundary, without a model or study database."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from tutor.session import TutorSession


class GoalConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.tutor = TutorSession(SimpleNamespace(id="conversation"), Path("unused"), "test", False,
                                  context_config=Path("config"), host_data=Path("host"))
        self.proposal = {"change": {"action": "create", "text": "Practise stacks"}, "key": "stable-key"}
        self.tutor.pending_goals.append(self.proposal)

    def test_declining_does_not_write(self):
        with patch("tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            self.assertIsNone(self.tutor.confirm_goal(self.proposal, False))
            save.assert_not_called()
        self.assertEqual(self.tutor.pending_goals, [])

    def test_uncertain_save_retains_same_payload_and_key_for_retry(self):
        with patch("tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            save.side_effect = [RuntimeError("lost response"), {"state": "active"}]
            with self.assertRaises(RuntimeError):
                self.tutor.confirm_goal(self.proposal, True)
            self.assertEqual(self.tutor.pending_goals, [self.proposal])
            self.assertEqual(self.tutor.confirm_goal(self.proposal, True), {"state": "active"})
            self.assertEqual(save.call_args_list[0], save.call_args_list[1])
        self.assertEqual(self.tutor.pending_goals, [])

    def test_preference_confirmation_uses_its_own_queue_and_tool(self):
        preference = {"change": {"explanationDepth": "concise", "hintStyle": "direct", "expectedVersion": 0}, "key": "prefs-key"}
        self.tutor.pending_preferences.append(preference)
        with patch("tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            save.return_value = {"version": 1}
            self.tutor.confirm_preferences(preference, True)
            self.assertEqual(save.call_args.kwargs, {"tool": "confirm_tutor_preferences"})
        self.assertEqual(self.tutor.pending_preferences, [])
        self.assertEqual(self.tutor.pending_goals, [self.proposal])

    def test_plan_confirmation_uses_its_own_queue_and_tool(self):
        plan = {"change": {"mode": "add", "items": [{"problemId": "p1", "title": "Two Sum", "reason": "Warm-up"}]}, "key": "plan-key"}
        self.tutor.pending_plan.append(plan)
        with patch("tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            save.return_value = {"added": ["Two Sum"]}
            self.tutor.confirm_plan(plan, True)
            self.assertEqual(save.call_args.kwargs, {"tool": "confirm_plan_change"})
        self.assertEqual(self.tutor.pending_plan, [])
        self.assertEqual(self.tutor.pending_goals, [self.proposal])

    def test_lesson_proposal_is_queued_then_saved_with_its_own_tool(self):
        change = {"action": "create", "text": "Say when a trie is optional.", "topic": "Tries"}
        def turn(message, on_text, on_tool):
            on_tool("propose_tutor_note", "completed", False, [json.dumps({"proposal": change, "saved": False})])
            return "Proposed a lesson.", None
        with TemporaryDirectory() as root, patch("tutor.session.load_snapshot", return_value={"status": "available"}):
            self.tutor.thread = SimpleNamespace(id="conversation", turn=turn)
            self.tutor.session_file = Path(root) / "last-session.json"
            self.tutor.chat_reply("That Tries label threw me off.")
        [lesson] = self.tutor.pending_notes
        self.assertEqual(lesson["change"], change)
        with patch("tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            save.return_value = {"version": 0}
            self.tutor.confirm_note(lesson, True)
            self.assertEqual(save.call_args.kwargs, {"tool": "confirm_tutor_note"})
        self.assertEqual(self.tutor.pending_notes, [])
        self.assertEqual(self.tutor.pending_goals, [self.proposal])

    def test_cannot_save_a_proposal_that_is_not_pending(self):
        self.tutor.pending_goals.clear()
        with self.assertRaises(ValueError):
            self.tutor.confirm_goal(self.proposal, True)


if __name__ == "__main__":
    unittest.main()
