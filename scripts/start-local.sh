#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
NODE_BINARY=${NODE_BINARY:-$(command -v node || true)}
if [ -z "$NODE_BINARY" ] || [ ! -x "$NODE_BINARY" ]; then
  printf '%s\n' 'Node.js 22+ was not found. Install Node, or set NODE_BINARY to its absolute path.' >&2
  exit 1
fi
exec "$NODE_BINARY" "$ROOT/scripts/launch-local.mjs"
