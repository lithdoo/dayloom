#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

if [[ -f ".env" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "${key// }" || "${key:0:1}" == "#" ]] && continue
    case "$key" in
      DEEPSEEK_API_KEY|DAYLOOM_LLM_API_NAME|DAYLOOM_LLM_MODEL|DAYLOOM_LLM_BASE_URL|DAYLOOM_LLM_API_KEY_ENV|PROMPTPILE_BIN)
        [[ -n "${value:-}" ]] && export "$key=$value"
        ;;
    esac
  done < ".env"
fi

WORLD_DIR="$SCRIPT_DIR/world2"
export DAY_LOOM_DIR="$SCRIPT_DIR/../.."

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"
mkdir -p "$WORLD_DIR"

echo "Opening dayloom-tui on: $WORLD_DIR"
echo
node "$DAY_LOOM_DIR/packages/tui/dist/main.js" "$WORLD_DIR"
