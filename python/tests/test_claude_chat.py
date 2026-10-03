"""Bloom chat on Claude Code: streaming, tool activity, proposals, resume and isolation."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from claude_agent_sdk import (AssistantMessage, ResultMessage, StreamEvent, TextBlock,
                              ToolResultBlock, ToolUseBlock, UserMessage)
from tutor.claude_chat import ClaudeChat
from tutor.session import TOOL_ACTIVITY, TutorSession, open_tutor

PROPOSAL = {"action": "create", "text": "Solve three graph problems"}


def turn_messages(answer="Proposed a goal for you."):
    return [
        StreamEvent(uuid="1", session_id="s", event={"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "Proposed "}}),
        AssistantMessage(content=[ToolUseBlock(id="t1", name="mcp__bloomcode__propose_learning_goal",
                                               input={})], model="claude-opus-5"),
        UserMessage(content=[ToolResultBlock(tool_use_id="t1", is_error=False, content=[
            {"type": "text", "text": json.dumps({"proposal": PROPOSAL, "saved": False})}])]),
        StreamEvent(uuid="2", session_id="s", event={"type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": "a goal for you."}}),
        AssistantMessage(content=[TextBlock(text=answer)], model="claude-opus-5"),
        ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
                      num_turns=2, session_id="s", result=answer, usage={"output_tokens": 9}),
    ]


def fake_query(calls):
    async def query(prompt, options):
        calls.append((prompt, options))
        for message in turn_messages():
            yield message
    return query


class ClaudeChatTests(unittest.TestCase):
    def test_a_turn_streams_text_reports_tools_and_captures_the_proposal(self):
        calls, deltas, activity = [], [], []
        sessions = []
        chat = ClaudeChat(lambda **session: sessions.append(session) or session, workspace=Path("/tmp/w"))
        with tempfile.TemporaryDirectory() as directory, \
                patch("claude_agent_sdk.query", fake_query(calls)):
            tutor = TutorSession(chat, Path(directory) / "last-session.json", "test", False, provider="claude")
            first_id = chat.id
            response = tutor.chat_reply("Help me set a goal", on_text=deltas.append, on_activity=activity.append)
            tutor.chat_reply("And another", on_text=deltas.append)
            saved = json.loads((Path(directory) / "last-session.json").read_text())
        self.assertEqual(response, "Proposed a goal for you.")
        self.assertEqual("".join(deltas[:2]), "Proposed a goal for you.")
        self.assertEqual(activity, ["Preparing a goal proposal…", "Goal proposal completed."])
        self.assertEqual([p["change"] for p in tutor.pending_goals], [PROPOSAL])  # deduplicated across turns
        self.assertEqual(tutor.last_usage, {"output_tokens": 9})
        # A new conversation claims its ID on the first turn, then resumes it.
        self.assertEqual(sessions, [{"session_id": first_id}, {"resume": first_id}])
        self.assertEqual(saved, {"thread_id": first_id, "workspace": "test", "provider": "claude"})

    def test_a_failed_turn_raises_and_a_failed_first_turn_never_reuses_its_id(self):
        async def failing(prompt, options):
            yield ResultMessage(subtype="error_during_execution", duration_ms=1, duration_api_ms=1,
                                is_error=True, num_turns=1, session_id="s", result="Not logged in")
        chat = ClaudeChat(lambda **session: session, workspace=Path("/tmp/w"))
        first = chat.id
        with patch("claude_agent_sdk.query", failing), self.assertRaises(RuntimeError):
            chat.turn("hi")
        self.assertNotEqual(chat.id, first)

    def test_open_tutor_runs_claude_isolated_with_only_the_bloom_tools(self):
        calls = []
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), \
                patch("claude_agent_sdk.query", fake_query(calls)), \
                patch("tutor.session._hidden_tools", return_value=["mcp__bloomcode__finish_attempt"]):
            data = Path(directory) / "data"
            data.mkdir()
            (data / "api-token").write_text("a")
            (data / "tutor-token").write_text("t")
            with open_tutor(provider="claude", cli_path="/bin/claude", token_file=data / "api-token",
                            state_dir=Path(directory) / "state") as tutor:
                with patch("tutor.session.load_snapshot", return_value={"status": "unavailable"}):
                    tutor.chat_reply("hello")
                platform = (Path(directory) / "state" / "platform.toml").read_text()
            self.assertNotIn("ANTHROPIC_API_KEY", os.environ)
        prompt, options = calls[0]
        self.assertEqual(json.loads(prompt)["learner_message"], "hello")
        self.assertEqual((options.model, options.cli_path), ("opus", "/bin/claude"))
        self.assertEqual(options.tools, [])
        self.assertEqual(options.setting_sources, [])
        self.assertEqual(options.permission_mode, "dontAsk")
        self.assertTrue(options.strict_mcp_config and options.include_partial_messages)
        # Safe mode would drop the MCP server; settings and skills stay off without it.
        self.assertNotIn("safe-mode", options.extra_args)
        self.assertIn("disable-slash-commands", options.extra_args)
        self.assertNotIn("no-session-persistence", options.extra_args)
        self.assertEqual(options.disallowed_tools, ["mcp__bloomcode__finish_attempt"])
        self.assertEqual(sorted(options.allowed_tools), sorted(f"mcp__bloomcode__{t}" for t in TOOL_ACTIVITY))
        server = options.mcp_servers["bloomcode"]
        self.assertTrue(server["args"][1].startswith("file://") and server["args"][1].endswith("tsx/dist/loader.mjs"))
        self.assertTrue(server["env"]["DATA_DIR"].endswith("api-data"))
        self.assertIn("[mcp_servers.bloomcode]", platform)
        self.assertNotIn("enabled_tools", platform)
