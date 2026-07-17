#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

WORLD_DIR="$SCRIPT_DIR/world"
export DAY_LOOM_DIR="$SCRIPT_DIR/../.."
export DAY_LOOM_FILESYSTEM_MCP_BIN="$SCRIPT_DIR/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"

mkdir -p "$WORLD_DIR"

echo "Opening dayloom-tui on: $WORLD_DIR"
echo

node "$DAY_LOOM_DIR/packages/tui/dist/main.js" \
  "$WORLD_DIR" \
  --no-auto-start \
  --locale zh
