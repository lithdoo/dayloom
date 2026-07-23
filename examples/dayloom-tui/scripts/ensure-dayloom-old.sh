#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DAY_LOOM_DIR:-}" ]]; then
  echo "[ERROR] ensure-dayloom-old.sh: DAY_LOOM_DIR is not set." >&2
  exit 1
fi

MODE="${1:-interactive}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXAMPLE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DAY_LOOM_CLI_DIST="$DAY_LOOM_DIR/packages/cli/dist/main.js"
DAY_LOOM_TUI_DIST="$DAY_LOOM_DIR/packages/tui-old/dist/main.js"
FILESYSTEM_MCP_DIST="$EXAMPLE_ROOT/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1); then
  echo "Installing dependencies in dayloom monorepo..."
  (cd "$DAY_LOOM_DIR" && npm install)
fi

echo "Building dayloom (core, cli, tui)..."
(cd "$DAY_LOOM_DIR" && npm run build)

if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1) \
  || [[ ! -f "$DAY_LOOM_CLI_DIST" ]] \
  || [[ ! -f "$DAY_LOOM_TUI_DIST" ]]; then
  echo "[ERROR] dayloom dependencies or dist are incomplete." >&2
  exit 1
fi

if [[ "$MODE" == "quick" ]]; then
  exit 0
fi

if [[ -z "${PROMPTPILE_MCP_BASE_URL:-}" && -z "${PROMPTPILE_MCP_BIN:-}" ]] \
  && ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile-mcp/package.json')" >/dev/null 2>&1) \
  && ! command -v promptpile-mcp >/dev/null 2>&1; then
  echo "[ERROR] promptpile-mcp CLI is required for interactive TUI sessions." >&2
  exit 1
fi

if [[ -z "${PROMPTPILE_MCP_BASE_URL:-}" && ! -f "$FILESYSTEM_MCP_DIST" ]]; then
  echo "Installing isolated filesystem MCP runtime..."
  npm install --prefix "$EXAMPLE_ROOT/.runtime" @modelcontextprotocol/server-filesystem@2026.1.14
fi

if [[ -z "${PROMPTPILE_MCP_BASE_URL:-}" && ! -f "$FILESYSTEM_MCP_DIST" ]]; then
  echo "[ERROR] filesystem MCP not found at: $FILESYSTEM_MCP_DIST" >&2
  exit 1
fi
