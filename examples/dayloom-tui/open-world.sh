#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

WORLD_DIR="$SCRIPT_DIR/world"
export DAY_LOOM_DIR="$SCRIPT_DIR/../.."

"$SCRIPT_DIR/scripts/ensure-dayloom.sh" quick

mkdir -p "$WORLD_DIR"

echo "Opening dayloom-tui on: $WORLD_DIR"
echo

node "$DAY_LOOM_DIR/packages/tui/dist/main.js" \
  "$WORLD_DIR" \
  --no-auto-start \
  --locale zh
