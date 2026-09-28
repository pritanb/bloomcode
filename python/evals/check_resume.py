"""Live save/resume check in disposable storage; uses Codex account usage."""

import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

chat = Path(__file__).resolve().parents[1] / "chat.py"
with TemporaryDirectory(prefix="bloomcode-resume-check-") as directory:
    state = Path(directory)

    def run(messages: str, *flags: str) -> str:
        result = subprocess.run(
            [sys.executable, str(chat), "--state-dir", directory, *flags],
            input=messages, text=True, capture_output=True, timeout=120,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        print(result.stdout, flush=True)
        return result.stdout

    run("My study-plan label is cobalt-cedar-417. Acknowledge briefly.\n/quit\n")
    original = json.loads((state / "last-session.json").read_text())["thread_id"]
    answer = run("What exact study-plan label did I tell you?\n/quit\n")
    assert "resumed conversation" in answer
    assert "cobalt-cedar-417" in answer
    assert json.loads((state / "last-session.json").read_text())["thread_id"] == original
    run("/quit\n", "--new")
    assert json.loads((state / "last-session.json").read_text())["thread_id"] == original
    run("I want to practise binary search. Acknowledge briefly.\n/quit\n", "--new")
    assert json.loads((state / "last-session.json").read_text())["thread_id"] != original
    print("PASS: process restart resumes history; --new replaces the pointer only after a reply.")
