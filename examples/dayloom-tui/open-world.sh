#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DAY_LOOM_DIR="$SCRIPT_DIR/../.."
WORLD_DIR="${1:-}"
LLM_CONFIG="${2:-${DAYLOOM_LLM_CONFIG:-}}"

if [[ -z "$WORLD_DIR" || -z "$LLM_CONFIG" ]]; then
  echo "Usage: ./open-world.sh <archive-v2-world> <llm-config>" >&2
  echo "The config may instead be supplied through DAYLOOM_LLM_CONFIG." >&2
  exit 1
fi

if [[ ! -d "$WORLD_DIR" ]]; then
  echo "World directory does not exist: $WORLD_DIR" >&2
  exit 1
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
node packages/tui/dist/main.js "$WORLD_DIR" --llm-config "$LLM_CONFIG"
