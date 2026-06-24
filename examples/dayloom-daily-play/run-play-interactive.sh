#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

if [[ -f ".env" ]]; then
  while IFS="=" read -r key value; do
    [[ -z "${key// }" || "${key:0:1}" == "#" ]] && continue
    case "$key" in
      DEEPSEEK_API_KEY|PROMPTPILE_MCP_BIN|PROMPTPILE_MCP_BASE_URL|PROMPTPILE_MCP_TOKEN)
        [[ -n "${value:-}" ]] && export "$key=$value"
        ;;
    esac
  done < ".env"
fi

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "[ERROR] DEEPSEEK_API_KEY is not set." >&2
  echo "Set it in the environment or create .env from .env.example." >&2
  exit 1
fi

OUT_DIR="$SCRIPT_DIR/output/world-daily-interactive"
export DAY_LOOM_DIR="$SCRIPT_DIR/../../packages/dayloom"
export DAY_LOOM_FILESYSTEM_MCP_BIN="$SCRIPT_DIR/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if [[ ! -f "$OUT_DIR/manifest.yaml" ]]; then
  echo "[ERROR] Planned World not found:" >&2
  echo "  $OUT_DIR" >&2
  echo >&2
  echo "Create a daily plan first:" >&2
  echo "  ./run-interactive.sh" >&2
  exit 1
fi

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"

PHASE=$(awk '/^phase:/ {print $2}' "$OUT_DIR/current.yaml")
case "$PHASE" in
  planned|playing) ;;
  settling)
    echo "Play is already complete; verifying output..."
    node "$SCRIPT_DIR/scripts/verify-play.js" "$OUT_DIR"
    exit 0
    ;;
  *)
    echo "[ERROR] Play requires phase planned or playing, got: $PHASE" >&2
    echo "Run ./run-interactive.sh first to create the daily plan." >&2
    exit 1
    ;;
esac

PLAY_ARGS=(-d "$OUT_DIR" --keep-session)
if [[ -n "${PROMPTPILE_MCP_BASE_URL:-}" ]]; then
  PLAY_ARGS+=(--mcp-base-url "$PROMPTPILE_MCP_BASE_URL")
  [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]] && PLAY_ARGS+=(--mcp-token "$PROMPTPILE_MCP_TOKEN")
fi

npx --prefix "$DAY_LOOM_DIR" dayloom play "${PLAY_ARGS[@]}"
node "$SCRIPT_DIR/scripts/verify-play.js" "$OUT_DIR"
