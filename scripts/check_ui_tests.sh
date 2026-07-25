#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
ENV_UI_DIR="$ROOT_DIR/internal/envapp/ui_src"
CODE_UI_DIR="$ROOT_DIR/internal/codeapp/ui_src"

source "$SCRIPT_DIR/ui_package_common.sh"

run_terminal_performance() {
  local -a command=(pnpm run test:terminal-performance)

  if ! command -v pnpm >/dev/null 2>&1; then
    command=(corepack pnpm run test:terminal-performance)
  fi
  if [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]]; then
    if ! command -v xvfb-run >/dev/null 2>&1; then
      ui_pkg_die "xvfb-run is required for terminal performance tests on Linux without DISPLAY"
    fi
    xvfb-run -a "${command[@]}"
    return
  fi
  "${command[@]}"
}

check_envapp_ui() {
  [ -d "$ENV_UI_DIR" ] || ui_pkg_die "Env App UI directory is missing: $ENV_UI_DIR"
  (
    cd "$ENV_UI_DIR"
    if ui_pkg_need_install "$ENV_UI_DIR"; then
      ui_pkg_run_pnpm install --frozen-lockfile
    fi
    ui_pkg_run_pnpm exec playwright install chromium
    ui_pkg_run_pnpm test
    ui_pkg_run_pnpm run test:browser
    run_terminal_performance
  )
}

check_codeapp_ui() {
  [ -d "$CODE_UI_DIR" ] || ui_pkg_die "Code App UI directory is missing: $CODE_UI_DIR"
  command -v npm >/dev/null 2>&1 || ui_pkg_die "npm not found (install Node.js)"
  (
    cd "$CODE_UI_DIR"
    if ui_pkg_need_install "$CODE_UI_DIR"; then
      npm ci
    fi
    npm test
  )
}

ui_pkg_log "Running complete local UI test gates..."
check_envapp_ui
check_codeapp_ui
ui_pkg_log "Complete local UI test gates passed."
