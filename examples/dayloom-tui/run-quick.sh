#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

OUT_DIR="$SCRIPT_DIR/output/world-quick"
export DAY_LOOM_DIR="$SCRIPT_DIR/../.."

"$SCRIPT_DIR/scripts/ensure-dayloom-old.sh" quick

if [[ -d "$OUT_DIR" ]]; then
  echo "Removing previous output: $OUT_DIR"
  rm -rf "$OUT_DIR"
fi

echo "Launching dayloom-tui-old with --quick (no API key required)..."
echo "Use --no-auto-start: explore the shell before any session starts."
echo

node "$DAY_LOOM_DIR/packages/tui-old/dist/main.js" \
  "$OUT_DIR" \
  --quick \
  --id campus_demo \
  --title "Campus Demo" \
  --no-auto-start

if [[ -f "$OUT_DIR/manifest.yaml" ]]; then
  echo
  echo "Verifying quick world..."
  node "$SCRIPT_DIR/../dayloom-init-revise/scripts/verify-world.js" "$OUT_DIR" --mode quick
  echo
  echo "Success: $OUT_DIR"
else
  echo "[WARN] World was not created. Run again and confirm quick init in the TUI shell."
  exit 1
fi
