"""Bloom chat turns on a Claude Code session, translated into provider-neutral callbacks.

Each turn runs one isolated CLI query that resumes the saved session. Only the
BloomCode MCP tools listed by the caller are allowed; built-in tools are off and
anything else is denied without prompting.
"""
import asyncio
from uuid import uuid4

from tutor.codex_chat import learner_text

PREFIX = "mcp__bloomcode__"


class ClaudeChat:
    def __init__(self, options, *, workspace, session_id=None):
        """options(**overrides) builds ClaudeAgentOptions for one turn."""
        self.options, self.workspace = options, workspace
        # A new conversation gets its ID up front, so the host can show it before the first reply.
        self.id = session_id or str(uuid4())
        self.started = session_id is not None

    def turn(self, message, *, on_text=None, on_tool=None):
        try:
            response, usage = asyncio.run(self._turn(message, on_text, on_tool))
        except Exception:
            if not self.started:
                self.id = str(uuid4())  # never reuse an ID a failed first turn may have claimed
            raise
        self.started = True
        return response, usage

    async def _turn(self, message, on_text, on_tool):
        from claude_agent_sdk import (AssistantMessage, ResultMessage, StreamEvent, TextBlock,
                                      ToolResultBlock, ToolUseBlock, UserMessage, query)
        session = {"resume": self.id} if self.started else {"session_id": self.id}
        tools, texts, result, streamed = {}, [], None, False
        async for item in query(prompt=message, options=self.options(**session)):
            if isinstance(item, StreamEvent):
                event = item.event
                if on_text and item.parent_tool_use_id is None:
                    if (streamed and event.get("type") == "content_block_start"
                            and event.get("content_block", {}).get("type") == "text"):
                        on_text("\n\n")
                    elif (event.get("type") == "content_block_delta"
                            and event.get("delta", {}).get("type") == "text_delta"):
                        on_text(event["delta"]["text"])
                        streamed = True
            elif isinstance(item, AssistantMessage) and item.parent_tool_use_id is None:
                texts += [block.text for block in item.content if isinstance(block, TextBlock) and block.text.strip()]
                for block in item.content:
                    if isinstance(block, ToolUseBlock) and block.name.startswith(PREFIX):
                        tools[block.id] = block.name.removeprefix(PREFIX)
                        if on_tool:
                            on_tool(tools[block.id], "started", False, None)
            elif isinstance(item, UserMessage) and isinstance(item.content, list):
                for block in item.content:
                    if isinstance(block, ToolResultBlock) and block.tool_use_id in tools and on_tool:
                        failed = bool(block.is_error)
                        on_tool(tools[block.tool_use_id], "completed", failed,
                                None if failed else result_texts(block.content))
            elif isinstance(item, ResultMessage):
                result = item
        if result is None or result.is_error:
            raise RuntimeError("The tutor did not complete a response.")
        # Claude often explains before a tool call and only signs off after it, so the
        # answer is every text of the turn; result.result holds just the last one.
        response = "\n\n".join(texts) or result.result
        if not response:
            raise RuntimeError("The tutor did not complete a response.")
        return response, result.usage

    def history(self):
        if not self.started:
            return []
        from claude_agent_sdk import get_session_messages
        messages, answer = [], None
        for entry in get_session_messages(self.id, directory=str(self.workspace)):
            content = (entry.message or {}).get("content")
            if entry.type == "user":
                text = content if isinstance(content, str) else "".join(
                    part.get("text", "") for part in content or [] if part.get("type") == "text")
                if not text:
                    continue  # a tool result, not a learner message
                if answer:
                    messages.append({"role": "assistant", "text": answer})
                answer = None
                messages.append({"role": "user", "text": learner_text(text)})
            elif entry.type == "assistant" and entry.parent_tool_use_id is None:
                text = "".join(part.get("text", "") for part in content or [] if part.get("type") == "text")
                if text.strip():
                    answer = f"{answer}\n\n{text}" if answer else text  # every text until the next learner message
        if answer:
            messages.append({"role": "assistant", "text": answer})
        return messages


def result_texts(content):
    if isinstance(content, str):
        return [content]
    return [part["text"] for part in content or [] if part.get("type") == "text"]
