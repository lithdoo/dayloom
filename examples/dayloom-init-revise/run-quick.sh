#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

OUT_DIR="$SCRIPT_DIR/output/world-quick"
export DAY_LOOM_DIR="$SCRIPT_DIR/../../packages/dayloom"

"$SCRIPT_DIR/scripts/ensure-dayloom.sh"

if [[ -d "$OUT_DIR" ]]; then
  echo "Removing previous output: $OUT_DIR"
  rm -rf "$OUT_DIR"
fi

echo "Running dayloom init --quick..."
npx --prefix "$DAY_LOOM_DIR" dayloom init \
  -d "$OUT_DIR" \
  --quick \
  --id campus_demo \
  --title "Campus Demo"

echo "Verifying world save..."
node "$SCRIPT_DIR/scripts/verify-world.js" "$OUT_DIR" --mode quick

echo
echo "Success: $OUT_DIR"
