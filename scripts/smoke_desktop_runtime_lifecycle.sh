#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

# shellcheck source=scripts/ui_package_common.sh
source "$SCRIPT_DIR/ui_package_common.sh"

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) ui_pkg_die "Desktop Runtime lifecycle smoke requires macOS or Linux" ;;
esac

ui_pkg_require_node_26 "$ROOT_DIR"
node "$SCRIPT_DIR/smoke_desktop_runtime_lifecycle.mjs"
