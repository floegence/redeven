#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
UI_DIR="$ROOT_DIR/internal/envapp/ui_src"
source "$SCRIPT_DIR/ui_package_common.sh"

run_terminal_carrier() {
  local fixture_bytes="$1"
  corepack pnpm run test:terminal-carrier -- --headless --fixture-bytes "$fixture_bytes"
}

cd "$UI_DIR"
if ui_pkg_need_install "$UI_DIR"; then
  ui_pkg_run_pnpm install --frozen-lockfile
fi
ui_pkg_run_pnpm exec playwright install chromium
corepack pnpm run test:built-dist-shell
run_terminal_carrier 65536
run_terminal_carrier 458752
