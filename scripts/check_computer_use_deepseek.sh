#!/usr/bin/env bash
set -euo pipefail

: "${REDEVEN_COMPUTER_USE_E2E:?set REDEVEN_COMPUTER_USE_E2E=1 to run the online qualification}"
if [[ "${REDEVEN_COMPUTER_USE_E2E}" != "1" ]]; then
  echo "computer-use qualification disabled (set REDEVEN_COMPUTER_USE_E2E=1)"
  exit 0
fi
model="${REDEVEN_COMPUTER_USE_MODEL:-deepseek-flash}"
if [[ "$model" != "deepseek-flash" ]]; then
  echo "qualification requires the configured deepseek-flash" >&2
  exit 1
fi

# Drive the actual built Desktop, its production tool registry, and the model
# adapter. A direct HTTP response with fabricated screenshots is not acceptance.
export GOWORK=off
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REDEVEN_COMPUTER_UI_SCENARIO="${REDEVEN_COMPUTER_UI_SCENARIO:-file-animation}"
export REDEVEN_COMPUTER_USE_MODEL="$model"
if [[ -z "${REDEVEN_DESKTOP_CDP:-}" && -z "${REDEVEN_COMPUTER_WEBTOP_URL:-}" ]]; then
  export REDEVEN_FLOWER_SMOKE_SUITE=computer
  if [[ "${REDEVEN_COMPUTER_NATIVE_E2E:-0}" == 1 ]]; then
    export REDEVEN_FLOWER_SMOKE_SUITE=computer-native
  fi
  export REDEVEN_FLOWER_SMOKE_MODEL="$model"
  exec "$root/scripts/smoke_flower_deepseek.sh"
fi
exec node "$root/internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs"
