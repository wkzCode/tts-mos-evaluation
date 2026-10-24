#!/bin/zsh
set -eu
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
NODE_BIN="${TTS_MOS_NODE_BIN:-/opt/homebrew/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  print -u2 "Node was not found at $NODE_BIN. Set TTS_MOS_NODE_BIN to your Node executable."
  exit 1
fi
exec "$NODE_BIN" "$SCRIPT_DIR/launch-local.mjs" "$@"
