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

OUT_DIR="$SCRIPT_DIR/output/world-daily-interactive"
export DAY_LOOM_DIR="$SCRIPT_DIR/../../packages/dayloom"
export DAY_LOOM_FILESYSTEM_MCP_BIN="$SCRIPT_DIR/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if [[ ! -f "$OUT_DIR/manifest.yaml" ]]; then
  echo "[ERROR] World not found: $OUT_DIR" >&2
  exit 1
fi

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"

PHASE=$(awk '/^phase:/ {print $2}' "$OUT_DIR/current.yaml")
if [[ "$PHASE" != "settling" ]]; then
  echo "[ERROR] Settle requires phase settling, got: $PHASE" >&2
  exit 1
fi

SETTLE_ARGS=(-d "$OUT_DIR" --keep-session)
if [[ -n "${PROMPTPILE_MCP_BASE_URL:-}" ]]; then
  SETTLE_ARGS+=(--mcp-base-url "$PROMPTPILE_MCP_BASE_URL")
  [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]] && SETTLE_ARGS+=(--mcp-token "$PROMPTPILE_MCP_TOKEN")
fi
SETTLE_ARGS+=("$@")

npx --prefix "$DAY_LOOM_DIR" dayloom settle "${SETTLE_ARGS[@]}"

PHASE=$(awk '/^phase:/ {print $2}' "$OUT_DIR/current.yaml")
if [[ "$PHASE" == "idle" ]]; then
  node "$SCRIPT_DIR/scripts/verify-settle.js" "$OUT_DIR"
else
  echo "Settlement draft generated. Review days/*/ending/settlement.proposal.json before applying it."
fi
