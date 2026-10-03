"""Bloom chat turns on a Codex thread, translated into provider-neutral callbacks."""
import json

from ai_core.model import stream_events


class CodexChat:
    def __init__(self, thread):
        self.thread = thread

    @property
    def id(self):
        return self.thread.id

    def turn(self, message, *, on_text=None, on_tool=None):
        """Run one turn. on_tool(name, phase, failed, texts): texts is None unless a result arrived."""
        completed = None
        final_response = None
        fallback_response = None
        usage = None
        answer_ids = set()
        for event in stream_events(self.thread.turn(message)):
            if event.method in {"item/started", "item/completed"}:
                item = event.payload.item.root
                if item.type == "agentMessage" and (item.phase is None or item.phase.value == "final_answer"):
                    answer_ids.add(item.id)
                if item.type == "mcpToolCall" and item.server == "bloomcode" and on_tool:
                    if event.method == "item/started":
                        on_tool(item.tool, "started", False, None)
                    else:
                        texts = None
                        if item.error is None and item.result is not None:
                            texts = [c["text"] for c in item.result.content if c.get("type") == "text"]
                        failed = item.error is not None or item.status.value == "failed"
                        on_tool(item.tool, "completed", failed, texts)
                elif event.method == "item/completed" and item.type == "agentMessage":
                    if item.phase is None:
                        fallback_response = item.text
                    elif item.phase.value == "final_answer":
                        final_response = item.text
            elif event.method == "item/agentMessage/delta" and on_text and event.payload.item_id in answer_ids:
                on_text(event.payload.delta)
            elif event.method == "thread/tokenUsage/updated":
                usage = event.payload.token_usage.model_dump(mode='json')
            elif event.method == "turn/completed":
                completed = event.payload.turn
        response = final_response or fallback_response
        if completed and completed.error:
            raise RuntimeError(completed.error.message)
        if completed is None or completed.status.value != "completed" or not response:
            raise RuntimeError("The tutor did not complete a response.")
        return response, usage

    def history(self):
        messages = []
        for turn in self.thread.read(include_turns=True).thread.turns:
            if turn.status.value != "completed":
                continue
            for wrapped in turn.items:
                item = wrapped.root
                if item.type == "userMessage":
                    for content in item.content:
                        value = content.root
                        if value.type == "text":
                            messages.append({"role": "user", "text": learner_text(value.text)})
                elif item.type == "agentMessage" and (item.phase is None or item.phase.value == "final_answer"):
                    messages.append({"role": "assistant", "text": item.text})
        return messages


def learner_text(text):
    """Unwrap the learner_message from a snapshot envelope."""
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "learner_message" in data:
            return data["learner_message"]
    except ValueError:
        pass
    return text
