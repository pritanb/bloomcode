"""The host confirmation boundary, without a model or study database."""

from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from bloom_tutor.session import TutorSession


class GoalConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.tutor = TutorSession(SimpleNamespace(id="conversation"), Path("unused"), "test", False,
                                  context_config=Path("config"), host_data=Path("host"))
        self.proposal = {"change": {"action": "create", "text": "Practise stacks"}, "key": "stable-key"}
        self.tutor.pending_goals.append(self.proposal)

    def test_declining_does_not_write(self):
        with patch("bloom_tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            self.assertIsNone(self.tutor.confirm_goal(self.proposal, False))
            save.assert_not_called()
        self.assertEqual(self.tutor.pending_goals, [])

    def test_uncertain_save_retains_same_payload_and_key_for_retry(self):
        with patch("bloom_tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
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
        with patch("bloom_tutor.session.save_confirmed_change", new_callable=AsyncMock) as save:
            save.return_value = {"version": 1}
            self.tutor.confirm_preferences(preference, True)
            self.assertEqual(save.call_args.kwargs, {"tool": "confirm_tutor_preferences"})
        self.assertEqual(self.tutor.pending_preferences, [])
        self.assertEqual(self.tutor.pending_goals, [self.proposal])

    def test_cannot_save_a_proposal_that_is_not_pending(self):
        self.tutor.pending_goals.clear()
        with self.assertRaises(ValueError):
            self.tutor.confirm_goal(self.proposal, True)


if __name__ == "__main__":
    unittest.main()
