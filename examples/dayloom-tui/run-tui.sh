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
  exit 1
fi

SOURCE_WORLD="$SCRIPT_DIR/../dayloom-init-revise/output/world-interactive"
OUT_DIR="$SCRIPT_DIR/output/world-tui-interactive"
export DAY_LOOM_DIR="$SCRIPT_DIR/../.."
export DAY_LOOM_FILESYSTEM_MCP_BIN="$SCRIPT_DIR/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if [[ ! -f "$SOURCE_WORLD/manifest.yaml" ]]; then
  echo "[ERROR] Source World not found:" >&2
  echo "  $SOURCE_WORLD" >&2
  echo >&2
  echo "Create it first:" >&2
  echo "  cd ../dayloom-init-revise" >&2
  echo "  ./run-interactive.sh" >&2
  echo >&2
  echo "Or try the no-API quick demo:" >&2
  echo "  ./run-quick.sh" >&2
  exit 1
fi

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"

if [[ ! -f "$OUT_DIR/manifest.yaml" ]]; then
  echo "Copying source World into TUI example output..."
  rm -rf "$OUT_DIR"
  mkdir -p "$(dirname "$OUT_DIR")"
  cp -R "$SOURCE_WORLD" "$OUT_DIR"
fi

TUI_ARGS=("$OUT_DIR" --keep-session --lang zh)
if [[ -n "${PROMPTPILE_MCP_BASE_URL:-}" ]]; then
  TUI_ARGS+=(--mcp-base-url "$PROMPTPILE_MCP_BASE_URL")
  [[ -n "${PROMPTPILE_MCP_TOKEN:-}" ]] && TUI_ARGS+=(--mcp-token "$PROMPTPILE_MCP_TOKEN")
fi

echo "Launching dayloom-tui on: $OUT_DIR"
echo "Shortcuts: Enter = newline, Ctrl+Enter = send, Y/N = confirm"
echo

npx --prefix "$DAY_LOOM_DIR" dayloom-tui "${TUI_ARGS[@]}"
