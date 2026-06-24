#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

if [[ -f ".env" ]]; then
  while IFS='=' read -r key value; do
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
  echo "Set DEEPSEEK_API_KEY in your environment, OR create .env in this folder with:" >&2
  echo "  DEEPSEEK_API_KEY=sk-..." >&2
  echo "If you updated a shell profile, open a new shell or run: source ~/.bashrc" >&2
  exit 1
fi

OUT_DIR="$SCRIPT_DIR/output/world-interactive"
export DAY_LOOM_DIR="$SCRIPT_DIR/../../packages/dayloom"
export DAY_LOOM_FILESYSTEM_MCP_BIN="$SCRIPT_DIR/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if [[ -f "$OUT_DIR/manifest.yaml" ]]; then
  "$SCRIPT_DIR/scripts/ensure-dayloom.sh" revise
  echo "Existing World found. Running dayloom revise..."
  REVISE_ARGS=(-d "$OUT_DIR" --keep-session)
  if [[ -n "${PROMPTPILE_MCP_BASE_URL:-}" ]]; then
    REVISE_ARGS+=(--mcp-base-url "$PROMPTPILE_MCP_BASE_URL")
    [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]] && REVISE_ARGS+=(--mcp-token "$PROMPTPILE_MCP_TOKEN")
  fi
  npx --prefix "$DAY_LOOM_DIR" dayloom revise "${REVISE_ARGS[@]}"
  echo "Verifying existing world save..."
  node "$SCRIPT_DIR/scripts/verify-world.js" "$OUT_DIR" --mode existing
  echo
  echo "Revised World: $OUT_DIR"
  exit 0
fi

if [[ -d "$OUT_DIR" ]]; then
  echo "[ERROR] Output directory exists but is not an initialized World:" >&2
  echo "  $OUT_DIR" >&2
  echo "Remove it manually or choose another path." >&2
  exit 1
fi

"$SCRIPT_DIR/scripts/ensure-dayloom.sh" init
echo "Running dayloom init (interactive)..."
echo "Finish each reply with Ctrl+D on an empty line."
npx --prefix "$DAY_LOOM_DIR" dayloom init \
  -d "$OUT_DIR" \
  --id campus_life \
  --title "校园日常" \
  --max-rounds 8 \
  --keep-session

echo "Verifying world save..."
node "$SCRIPT_DIR/scripts/verify-world.js" "$OUT_DIR" --mode interactive

echo
echo "Initialized World: $OUT_DIR"
