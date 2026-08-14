#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DAY_LOOM_DIR:-}" ]]; then echo "[ERROR] DAY_LOOM_DIR is not set." >&2; exit 1; fi
if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1); then
  (cd "$DAY_LOOM_DIR" && npm install)
fi
(cd "$DAY_LOOM_DIR" \
  && npm run build -w @dayloom/archive-protocol \
  && npm run build -w @dayloom/core2 \
  && npm run build -w @dayloom/tui)

[[ -f "$DAY_LOOM_DIR/packages/archive-protocol/dist/index.js" ]]
[[ -f "$DAY_LOOM_DIR/packages/core2/dist/index.js" ]]
[[ -f "$DAY_LOOM_DIR/packages/tui/dist/main.js" ]]
