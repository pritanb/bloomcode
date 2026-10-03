"""Version 1 JSON-lines bridge. Stdout is protocol only; Fastify owns cancellation."""

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import signal
import sys

from tutor.session import open_tutor


from ai_core.protocol import emit


# The provider being opened, for the startup error message.
provider = "codex"


def history(tutor):
    if not tutor.session_file.exists() or json.loads(tutor.session_file.read_text())["thread_id"] != tutor.thread.id:
        return []
    return tutor.thread.history()[-100:]


def state(tutor):
    coaching = tutor.coaching.view() if tutor.coaching else None
    messages = (coaching['messages'] if coaching and coaching['status'] != 'paused' else history(tutor))
    notice = tutor.coaching.notice if tutor.coaching else None
    if notice:
        messages = [*messages, {'role': 'assistant', 'text': notice}]
    return {"conversationId": tutor.thread.id, "messages": messages[-100:],
            "coaching": coaching, "coachingError": tutor.coaching_error, "proposals": [
        {"kind": kind, **proposal} for kind, pending in [
            ("goal", tutor.pending_goals), ("preferences", tutor.pending_preferences),
            ("plan", tutor.pending_plan),
        ] for proposal in pending
    ]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--provider", choices=("codex", "claude"), default="codex")
    parser.add_argument("--model")
    parser.add_argument("--cli-path")
    args = parser.parse_args()
    global provider
    provider = args.provider
    runtime = dict(provider=args.provider, model=args.model, cli_path=args.cli_path,
                   api_url=args.api_url, token_file=args.token_file)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with ExitStack() as stack:
        tutor = stack.enter_context(open_tutor(**runtime))
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
                    pending, confirm, label = {
                        "goal": (tutor.pending_goals, tutor.confirm_goal, "Goal"),
                        "preferences": (tutor.pending_preferences, tutor.confirm_preferences, "Teaching preferences"),
                        "plan": (tutor.pending_plan, tutor.confirm_plan, "Plan"),
                    }[kind]
                    proposal = next(p for p in pending if p["key"] == request["key"])
                    saved = confirm(proposal, request["approved"] is True)
                    if kind == "plan" and saved is not None:
                        activity = ("Updated today's plan." if saved["added"] or saved["removed"]
                                    else "Today's plan already had those problems.")
                    else:
                        activity = label + (" saved." if request["approved"] is True else " change discarded.")
                elif method == "new":
                    stack.close()
                    tutor = stack.enter_context(open_tutor(**runtime, new=True))
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
        elif provider == "claude":
            message = "Tutor startup failed. Check Python dependencies, the running backend, and Claude Code sign-in (`claude auth login`)."
        else:
            message = "Tutor startup failed. Check Python dependencies, the running backend, and Codex sign-in."
        emit("fatal", message=message)
        raise SystemExit(1)
