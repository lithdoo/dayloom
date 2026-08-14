#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DAY_LOOM_DIR:-}" ]]; then
  echo "[ERROR] ensure-dayloom.sh: DAY_LOOM_DIR is not set." >&2
  exit 1
fi

if ! (cd "$DAY_LOOM_DIR" && node -e "require.resolve('promptpile/package.json')" >/dev/null 2>&1); then
  echo "Installing dayloom workspace dependencies..."
  (cd "$DAY_LOOM_DIR" && npm install)
fi

echo "Building dayloom core and tui..."
(cd "$DAY_LOOM_DIR" && npm run build -w @dayloom/core -w @dayloom/tui)

if [[ ! -f "$DAY_LOOM_DIR/packages/core/dist/index.js" ]] \
  || [[ ! -f "$DAY_LOOM_DIR/packages/tui/dist/main.js" ]]; then
  echo "[ERROR] core or tui build output is incomplete." >&2
  exit 1
fi
