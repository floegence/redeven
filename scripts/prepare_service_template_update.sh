#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
source "$ROOT_DIR/scripts/ui_package_common.sh"
ui_pkg_require_node_26 "$ROOT_DIR"
(
  cd "$ROOT_DIR/internal/envapp/ui_src"
  ui_pkg_run_pnpm install --frozen-lockfile
)
for package in desktop internal/codeapp/ui_src; do
  (
    cd "$ROOT_DIR/$package"
    npm ci --no-audit --no-fund
  )
done
