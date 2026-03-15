#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

lint_envapp_ui() {
  local dir="$ROOT_DIR/internal/envapp/ui_src"
  if [ ! -d "$dir" ]; then
    ui_pkg_log "Env App UI: skipped (missing: $dir)"
    return 0
  fi

  ui_pkg_log ""
  ui_pkg_log "Env App UI: linting..."
  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      ui_pkg_run_pnpm install --frozen-lockfile
    fi
    ui_pkg_run_pnpm lint
  )
  ui_pkg_log "Env App UI: done."
}

lint_codeapp_ui() {
  local dir="$ROOT_DIR/internal/codeapp/ui_src"
  if [ ! -d "$dir" ]; then
    ui_pkg_log "Code App UI: skipped (missing: $dir)"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js)"
  fi

  ui_pkg_log ""
  ui_pkg_log "Code App UI: linting..."
  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      npm ci
    fi
    npm run lint
  )
  ui_pkg_log "Code App UI: done."
}

main() {
  ui_pkg_log "Linting redeven UI source packages..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    ui_pkg_log "REDEVEN_AGENT_FORCE_INSTALL=1 (dependency reinstall enabled)"
  fi

  lint_envapp_ui
  lint_codeapp_ui

  ui_pkg_log ""
  ui_pkg_log "All UI lint checks passed."
}

main "$@"
