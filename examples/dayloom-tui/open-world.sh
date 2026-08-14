#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DAY_LOOM_DIR="$SCRIPT_DIR/../.."
WORLD_DIR="$SCRIPT_DIR/world"
LLM_CONFIG="$SCRIPT_DIR/llm.toml"

if [[ ! -f "$LLM_CONFIG" ]]; then
  echo "Creating default LLM config: $LLM_CONFIG"
  cp "$SCRIPT_DIR/llm.example.toml" "$LLM_CONFIG"
fi

export DAY_LOOM_DIR
bash "$SCRIPT_DIR/scripts/ensure-dayloom.sh"
mkdir -p "$WORLD_DIR"

echo "Opening dayloom-tui on: $WORLD_DIR"
node "$DAY_LOOM_DIR/packages/tui/dist/main.js" "$WORLD_DIR" --llm-config "$LLM_CONFIG"
