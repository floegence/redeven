#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
UI_DIR="$ROOT_DIR/internal/envapp/ui_src"
source "$SCRIPT_DIR/ui_package_common.sh"

run_terminal_carrier() {
  local fixture_bytes="$1"
  local -a command=(corepack pnpm run test:terminal-carrier -- --fixture-bytes "$fixture_bytes")

  if [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
    if ! command -v xvfb-run >/dev/null 2>&1; then
      echo "xvfb-run is required for headed terminal carrier E2E on Linux without DISPLAY" >&2
      return 1
    fi
    xvfb-run -a "${command[@]}"
    return
  fi
  "${command[@]}"
}

cd "$UI_DIR"
if ui_pkg_need_install "$UI_DIR"; then
  ui_pkg_run_pnpm install --frozen-lockfile
fi
ui_pkg_run_pnpm exec playwright install chromium
corepack pnpm run test:built-dist-shell
run_terminal_carrier 65536
run_terminal_carrier 458752
