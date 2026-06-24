#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

OUT_DIR="$SCRIPT_DIR/output/world-revise-smoke"
export DAY_LOOM_DIR="$SCRIPT_DIR/../../packages/dayloom"

"$SCRIPT_DIR/scripts/ensure-dayloom.sh" init
rm -rf "$OUT_DIR"

npx --prefix "$DAY_LOOM_DIR" dayloom init \
  -d "$OUT_DIR" \
  --quick \
  --id revise_smoke \
  --title "Revise Smoke"

npx --prefix "$DAY_LOOM_DIR" dayloom revise \
  -d "$OUT_DIR" \
  --proposal "$SCRIPT_DIR/fixtures/revise-proposal.json" \
  --dry-run

npx --prefix "$DAY_LOOM_DIR" dayloom revise \
  -d "$OUT_DIR" \
  --proposal "$SCRIPT_DIR/fixtures/revise-proposal.json" \
  --yes

node "$SCRIPT_DIR/scripts/verify-world.js" "$OUT_DIR" --mode revise
