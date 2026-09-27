"""Terminal entry point for the first tutor integration."""

import argparse
import sys
from pathlib import Path

from openai_codex import CodexError

from tutor import open_tutor


def main() -> int:
    parser = argparse.ArgumentParser(description="Talk to BloomCode's DSA tutor.")
    parser.add_argument("--model", default="gpt-6-sol")
    parser.add_argument("--attempt", help="Completed BloomCode attempt ID to discuss")
    parser.add_argument("--api-url", default="http://127.0.0.1:4317")
    parser.add_argument("--token-file", type=Path, help="Path to BloomCode's api-token file")
    args = parser.parse_args()
    if args.attempt and not args.token_file:
        parser.error("--attempt requires --token-file")

    try:
        with open_tutor(args.model, api_url=args.api_url, token_file=args.token_file) as tutor:
            print("BloomCode tutor — /quit to exit. Memory lasts until you exit.")
            if args.token_file:
                print("Attempt tools enabled. Try: Let's discuss my latest attempt.")
            if args.attempt:
                print(f"\nTutor: {tutor.reply(f'Help me reflect on attempt {args.attempt}.')}", flush=True)
            while True:
                message = input("\nYou: ").strip()
                if message == "/quit":
                    return 0
                if not message:
                    continue
                print("Tutor: thinking…", flush=True)
                print(f"\nTutor: {tutor.reply(message)}", flush=True)
    except (EOFError, KeyboardInterrupt):
        print("\nConversation ended.")
        return 0
    except (CodexError, RuntimeError, OSError, ValueError) as error:
        print(f"Tutor could not continue: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
