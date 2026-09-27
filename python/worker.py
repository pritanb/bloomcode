"""Version 1 JSON-lines bridge. Stdout is protocol only; Fastify owns cancellation."""

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import signal
import sys

from tutor import open_tutor


def emit(kind, id=None, **data):
    print(json.dumps({"v": 1, "type": kind, "id": id, **data}), flush=True)


def history(tutor):
    if not tutor.session_file.exists() or json.loads(tutor.session_file.read_text())["thread_id"] != tutor.thread.id:
        return []
    messages = []
    for turn in tutor.thread.read(include_turns=True).thread.turns:
        if turn.status.value != "completed":
            continue
        for wrapped in turn.items:
            item = wrapped.root
            if item.type == "userMessage":
                for content in item.content:
                    value = content.root
                    if value.type != "text":
                        continue
                    text = value.text
                    try:
                        data = json.loads(text)
                        if isinstance(data, dict) and "learner_message" in data:
                            text = data["learner_message"]
                    except ValueError:
                        pass
                    messages.append({"role": "user", "text": text})
            elif item.type == "agentMessage" and (item.phase is None or item.phase.value == "final_answer"):
                messages.append({"role": "assistant", "text": item.text})
    return messages[-100:]


def state(tutor):
    coaching = tutor.coaching.view() if tutor.coaching else None
    messages = (coaching['messages'] if coaching and coaching['status'] != 'paused' else history(tutor))
    notice = tutor.coaching.notice if tutor.coaching else None
    if notice:
        messages = [*messages, {'role': 'assistant', 'text': notice}]
    return {"conversationId": tutor.thread.id, "messages": messages[-100:],
            "coaching": coaching, "coachingError": tutor.coaching_error, "proposals": [
        {"kind": kind, **proposal} for kind, pending in [
            ("goal", tutor.pending_goals), ("preferences", tutor.pending_preferences)
        ] for proposal in pending
    ]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with ExitStack() as stack:
        tutor = stack.enter_context(open_tutor(api_url=args.api_url, token_file=args.token_file))
        emit("ready", **state(tutor))
        for line in sys.stdin:
            request = json.loads(line)
            id = request.get("id")
            try:
                activity = ""
                if request.get("v") != 1:
                    raise ValueError("Unsupported protocol")
                method = request["method"]
                if method == "reply":
                    tutor.reply(request["message"], request_id=id,
                        context_id=request.get('attemptId'), coaching_target=request.get('coach'),
                        on_activity=lambda message: emit("activity", id, message=message),
                        on_text=lambda text: emit("delta", id, text=text))
                elif method == "coaching":
                    if not tutor.coaching:
                        raise RuntimeError('Coaching is unavailable')
                    tutor.coaching.control(request['action'])
                elif method == "confirm":
                    kind = request["kind"]
                    pending = tutor.pending_goals if kind == "goal" else tutor.pending_preferences
                    proposal = next(p for p in pending if p["key"] == request["key"])
                    confirm = tutor.confirm_goal if kind == "goal" else tutor.confirm_preferences
                    confirm(proposal, request["approved"] is True)
                    activity = ("Goal" if kind == "goal" else "Teaching preferences") + (
                        " saved." if request["approved"] is True else " change discarded."
                    )
                elif method == "new":
                    stack.close()
                    tutor = stack.enter_context(open_tutor(api_url=args.api_url, token_file=args.token_file, new=True))
                else:
                    raise ValueError("Unknown request")
                emit("result", id, activity=activity, **state(tutor))
            except Exception:
                emit("error", id, **state(tutor), message="The tutor could not finish. Retry the coaching step or return to chat. If no retry is offered, send your message again. Confirmation can be retried with the same proposal.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error)
        if "already open" in message:
            message = "Close the terminal tutor before opening the in-app tutor."
        elif "auth.json" in message:
            message = "Sign in to Codex with file-based authentication before opening the tutor."
        else:
            message = "Tutor startup failed. Check Python dependencies, the running backend, and Codex sign-in."
        emit("fatal", message=message)
        raise SystemExit(1)
