"""Terminal entry point for the first tutor integration."""

import argparse
import json
import sys
from pathlib import Path

from openai_codex import CodexError

from bloom_tutor.session import open_tutor


def show_activity(message: str) -> None:
    print(f"Tutor: {message}", flush=True)


def review_changes(tutor) -> None:
    for label, pending, confirm in [
        ("goal", tutor.pending_goals, tutor.confirm_goal),
        ("preferences", tutor.pending_preferences, tutor.confirm_preferences),
    ]:
        _review_proposals(label, pending, confirm)


def _review_proposals(label, pending, confirm) -> None:
    for proposal in list(pending):
        print(f"\nProposed {label} change (not saved):")
        print(json.dumps(proposal["change"], indent=2))
        approved = input('Save this exact change? Type "yes" to confirm; Enter to discard: ').strip().lower() == "yes"
        try:
            saved = confirm(proposal, approved)
            print(f"Saved {label}." if saved else "Proposal discarded.")
        except Exception:
            print("Could not confirm the save. Use /confirm to retry the same change safely, or discard it.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Talk to BloomCode's DSA tutor.")
    parser.add_argument("--model", default="gpt-6-sol")
    parser.add_argument("--attempt", help="Completed BloomCode attempt ID to discuss")
    parser.add_argument("--api-url", default="http://127.0.0.1:4317")
    parser.add_argument("--token-file", type=Path, help="Path to BloomCode's api-token file")
    parser.add_argument("--new", action="store_true", help="Start a new conversation")
    parser.add_argument("--state-dir", type=Path, help="Override local conversation storage")
    args = parser.parse_args()
    if args.attempt and not args.token_file:
        parser.error("--attempt requires --token-file")

    try:
        with open_tutor(args.model, api_url=args.api_url, token_file=args.token_file,
                        state_dir=args.state_dir, new=args.new) as tutor:
            print(f"BloomCode tutor — {'resumed conversation' if tutor.resumed else 'new conversation'}. /quit to exit.")
            if args.token_file:
                print("Attempt tools enabled. /coach latest starts coaching; /coach Two Sum finds a problem.")
            if args.attempt:
                print(f"\nTutor: {tutor.reply(f'Help me reflect on attempt {args.attempt}.', on_activity=show_activity)}", flush=True)
                review_changes(tutor)
            while True:
                message = input("\nYou: ").strip()
                if message == "/quit":
                    return 0
                if message in ('/coach-pause', '/coach-resume', '/coach-retry'):
                    if tutor.coaching:
                        tutor.coaching.control(message.removeprefix('/coach-'))
                        view = tutor.coaching.view()
                        print(json.dumps(view, indent=2))
                    continue
                if message == "/confirm":
                    review_changes(tutor)
                    continue
                if not message:
                    continue
                print("Tutor: thinking…", flush=True)
                print(f"\nTutor: {tutor.reply(message, on_activity=show_activity)}", flush=True)
                review_changes(tutor)
    except (EOFError, KeyboardInterrupt):
        print("\nConversation ended.")
        return 0
    except (CodexError, RuntimeError, OSError, ValueError) as error:
        print(f"Tutor could not continue: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
