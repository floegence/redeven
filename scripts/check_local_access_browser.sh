#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
cd "$ROOT_DIR"
REDEVEN_LOCAL_ACCESS_BROWSER=1 GOWORK=off go test ./internal/localui -run '^TestLocalAccessBrowserSession$' -count=1 -timeout=2m -v
