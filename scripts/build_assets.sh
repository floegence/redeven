#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

build_envapp_ui() {
  local dir="$ROOT_DIR/internal/envapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Env App UI: skipped (missing: $dir)"
    return 0
  fi

  ui_pkg_log ""
  ui_pkg_log "Env App UI: building..."
  (
    cd "$dir"
    # Clear Vite pre-bundle cache so upgraded dependencies in node_modules are rebuilt.
    rm -rf node_modules/.vite 2>/dev/null || true
    if ui_pkg_need_install "$dir"; then
      ui_pkg_run_pnpm install --frozen-lockfile
    fi
    ui_pkg_run_pnpm build
  )
  ui_pkg_log "Env App UI: done."
}

build_codeapp_ui() {
  local dir="$ROOT_DIR/internal/codeapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Code App UI: skipped (missing: $dir)"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js)"
  fi

  ui_pkg_log ""
  ui_pkg_log "Code App UI: building..."
  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      npm ci --no-audit --no-fund
    fi
    npm run --silent build
  )
  ui_pkg_log "Code App UI: done."
}

build_knowledge_bundle() {
  local script="$ROOT_DIR/scripts/build_knowledge_bundle.sh"
  if [ ! -x "$script" ]; then
    ui_pkg_die "missing executable knowledge bundle builder: $script"
  fi

  ui_pkg_log ""
  ui_pkg_log "Knowledge bundle: building..."
  "$script"
  ui_pkg_log "Knowledge bundle: done."
}

verify_third_party_notices() {
  local script="$ROOT_DIR/scripts/generate_third_party_notices.mjs"
  if [ ! -f "$script" ]; then
    ui_pkg_die "missing third-party notice generator: $script"
  fi
  if ! command -v node >/dev/null 2>&1; then
    ui_pkg_die "node not found (required to verify third-party notices)"
  fi

  ui_pkg_log ""
  ui_pkg_log "Third-party notices: verifying..."
  node "$script" --check
  ui_pkg_log "Third-party notices: done."
}

main() {
  ui_pkg_log "Building redeven embedded assets..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    ui_pkg_log "REDEVEN_AGENT_FORCE_INSTALL=1 (dependency reinstall enabled)"
  fi

  build_envapp_ui
  build_codeapp_ui
  build_knowledge_bundle
  verify_third_party_notices

  ui_pkg_log ""
  ui_pkg_log "All embedded assets built."
}

main "$@"
