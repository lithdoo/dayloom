#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DAY_LOOM_DIR:-}" ]]; then echo "[ERROR] DAY_LOOM_DIR is not set." >&2; exit 1; fi
if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile')" >/dev/null 2>&1); then
  echo "[Dayloom] Dependencies are missing. Running npm install..."
  (cd "$DAY_LOOM_DIR" && npm install)
fi
echo "[Dayloom] Building archive-protocol..."
(cd "$DAY_LOOM_DIR" \
  && npm run build -w @dayloom/archive-protocol \
  && echo "[Dayloom] Building core2..." \
  && npm run build -w @dayloom/core2 \
  && echo "[Dayloom] Building TUI..." \
  && npm run build -w @dayloom/tui)

[[ -f "$DAY_LOOM_DIR/packages/archive-protocol/dist/index.js" ]]
[[ -f "$DAY_LOOM_DIR/packages/core2/dist/index.js" ]]
[[ -f "$DAY_LOOM_DIR/packages/tui/dist/main.js" ]]
