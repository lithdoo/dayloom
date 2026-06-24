#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DAY_LOOM_DIR:-}" ]]; then
  echo "[ERROR] ensure-dayloom.sh: DAY_LOOM_DIR is not set." >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXAMPLE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DAY_LOOM_DIST="$DAY_LOOM_DIR/dist/index.js"
FILESYSTEM_MCP_DIST="$EXAMPLE_ROOT/.runtime/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"

if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1); then
  echo "Installing dependencies in packages/dayloom..."
  (cd "$DAY_LOOM_DIR" && npm install)
fi

echo "Building dayloom..."
(cd "$DAY_LOOM_DIR" && npm run build)

if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1) || [[ ! -f "$DAY_LOOM_DIST" ]]; then
  echo "[ERROR] dayloom dependencies or dist are incomplete." >&2
  exit 1
fi

if [[ -z "${PROMPTPILE_MCP_BASE_URL:-}" && -z "${PROMPTPILE_MCP_BIN:-}" ]] \
  && ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile-mcp/package.json')" >/dev/null 2>&1) \
  && ! command -v promptpile-mcp >/dev/null 2>&1; then
  echo "[ERROR] promptpile-mcp CLI is required for interactive daily/play." >&2
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
