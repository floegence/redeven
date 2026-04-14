#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

exec "$SCRIPT_DIR/build_desktop_bundled_runtime.sh" "$@"
