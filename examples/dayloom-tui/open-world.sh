#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DAY_LOOM_DIR="$SCRIPT_DIR/../.."
WORLD_DIR="${1:-$SCRIPT_DIR/world}"
LLM_CONFIG="${2:-${DAYLOOM_LLM_CONFIG:-}}"

if [[ -z "$LLM_CONFIG" ]]; then
  LLM_CONFIG="$SCRIPT_DIR/llm.toml"
  if [[ ! -f "$LLM_CONFIG" ]]; then
    if ! cp "$SCRIPT_DIR/llm.example.toml" "$LLM_CONFIG"; then
      echo "Failed to create default LLM config: $LLM_CONFIG" >&2
      exit 1
    fi
  fi
fi

if [[ ! -d "$WORLD_DIR" ]]; then
  if ! mkdir -p "$WORLD_DIR"; then
    echo "Failed to create world directory: $WORLD_DIR" >&2
    exit 1
  fi
fi
if [[ ! -f "$LLM_CONFIG" ]]; then
  echo "LLM config does not exist: $LLM_CONFIG" >&2
  exit 1
fi

WORLD_DIR=$(cd "$WORLD_DIR" && pwd -P)
LLM_CONFIG_DIR=$(cd "$(dirname "$LLM_CONFIG")" && pwd -P)
LLM_CONFIG="$LLM_CONFIG_DIR/$(basename "$LLM_CONFIG")"

cd "$DAY_LOOM_DIR"
npm run build -w @dayloom/archive-protocol -w @dayloom/core2 -w @dayloom/tui
node examples/dayloom-tui/init-world.mjs "$WORLD_DIR"
node packages/tui/dist/main.js "$WORLD_DIR" --llm-config "$LLM_CONFIG"
