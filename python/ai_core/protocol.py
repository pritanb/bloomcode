"""Bounded versioned messages; the parent owns the process deadline."""
import json
import sys

MAX_MESSAGE = 2_000_000


def emit(kind, id=None, **data):
    print(json.dumps({'v': 1, 'type': kind, 'id': id, **data}), flush=True)


def receive(expected_id=None):
    line = sys.stdin.readline(MAX_MESSAGE + 1)
    if not line or len(line) > MAX_MESSAGE:
        raise RuntimeError('Worker input closed or exceeded its limit.')
    value = json.loads(line)
    if value.get('v') != 1 or (expected_id is not None and value.get('id') != expected_id):
        raise ValueError('Unsupported or mismatched worker message.')
    if value.get('type') == 'cancel':
        raise SystemExit(0)
    return value
