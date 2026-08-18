#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
ENV_UI_DIR="$ROOT_DIR/internal/envapp/ui_src"
CODE_UI_DIR="$ROOT_DIR/internal/codeapp/ui_src"

source "$SCRIPT_DIR/ui_package_common.sh"

# Node 26 exposes an experimental global localStorage getter that throws when
# no backing file is configured. Give the gate an isolated temporary backing
# file so Node's storage API remains available without requiring hidden caller
# configuration, while preserving caller-provided Node options.
ui_localstorage_file=""
case " ${NODE_OPTIONS:-} " in
  *" --localstorage-file="*|*" --localstorage-file "*) ;;
  *)
    ui_localstorage_file=$(mktemp "${TMPDIR:-/tmp}/redeven-ui-localstorage.XXXXXX")
    trap 'rm -f -- "$ui_localstorage_file" "$ui_localstorage_file-wal" "$ui_localstorage_file-shm"' EXIT HUP INT TERM
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--localstorage-file=$ui_localstorage_file"
    ;;
esac

run_terminal_performance() {
  command -v corepack >/dev/null 2>&1 || ui_pkg_die "corepack not found (install Node.js)"
  corepack pnpm run test:terminal-performance
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
