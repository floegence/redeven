#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

main() {
  local dir="$ROOT_DIR/desktop"

  if [ ! -d "$dir" ]; then
    ui_pkg_log "Desktop: skipped (missing: $dir)"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js)"
  fi

  ui_pkg_log "Checking Redeven Desktop package..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"

  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      npm ci
    fi
    npm run lint
    npm run typecheck
    npm run test
    npm run build
  )

  ui_pkg_log "Redeven Desktop checks passed."
}

main "$@"
