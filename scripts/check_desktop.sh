#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

usage() {
  cat <<'USAGE'
Usage: ./scripts/check_desktop.sh [--ci|--full]

  --ci    Run the lightweight Desktop gate for GitHub Actions.
  --full  Run the full Desktop gate, including heavier Vitest suites.
USAGE
}

main() {
  local mode="full"
  local dir="$ROOT_DIR/desktop"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ci)
        mode="ci"
        ;;
      --full)
        mode="full"
        ;;
      -h|--help)
        usage
        return 0
        ;;
      *)
        ui_pkg_die "unknown check_desktop option: $1"
        ;;
    esac
    shift
  done

  if [ ! -d "$dir" ]; then
    ui_pkg_log "Desktop: skipped (missing: $dir)"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js)"
  fi

  ui_pkg_log "Checking Redeven Desktop package..."
  ui_pkg_log "MODE: $mode"
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"

  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      npm ci
    fi
    npm run lint
    npm run typecheck
    npm run test:runtime-compatibility
    # IMPORTANT: GitHub Actions runs the lightweight Desktop gate; full Vitest
    # coverage is intentionally owned by local pre-commit. The focused Runtime
    # compatibility matrix always runs because it protects the open boundary.
    if [ "$mode" = "full" ]; then
      npm run test
    fi
    npm run build
  )

  ui_pkg_log "Redeven Desktop checks passed."
}

main "$@"
