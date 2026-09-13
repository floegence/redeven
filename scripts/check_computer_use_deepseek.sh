#!/usr/bin/env bash
set -euo pipefail

: "${REDEVEN_COMPUTER_USE_E2E:?set REDEVEN_COMPUTER_USE_E2E=1 to run the online qualification}"
if [[ "${REDEVEN_COMPUTER_USE_E2E}" != "1" ]]; then
  echo "computer-use qualification disabled (set REDEVEN_COMPUTER_USE_E2E=1)"
  exit 0
fi
model="${REDEVEN_COMPUTER_USE_MODEL:-deepseek-v4-flash-vision-exp}"
if [[ "$model" != "deepseek-v4-flash-vision-exp" ]]; then
  echo "qualification requires deepseek-v4-flash-vision-exp" >&2
  exit 1
fi

# Drive the actual built Desktop, its production tool registry, and the model
# adapter. A direct HTTP response with fabricated screenshots is not acceptance.
export GOWORK=off
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$root/internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs"
