#!/bin/sh
# Double-click in Finder; no LaunchAgent, login item or Hermes configuration is installed.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! /bin/sh "$ROOT/scripts/start-local.sh"; then
  printf '\n%s\n' 'Launch failed. See the error above. Press Return to close.'
  read -r ignored
  exit 1
fi
