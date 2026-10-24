#!/bin/zsh
set -eu
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
NODE_BIN="${TTS_MOS_NODE_BIN:-/opt/homebrew/bin/node}"
exec "$NODE_BIN" "$SCRIPT_DIR/stop-local.mjs" "$@"
