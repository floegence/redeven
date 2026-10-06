#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
cd "$ROOT_DIR"
if [[ -z "${REDEVEN_CODE_SERVER_BIN:-}" ]]; then
  REDEVEN_CODE_SERVER_BIN=$(command -v code-server || true)
fi
if [[ -z "$REDEVEN_CODE_SERVER_BIN" || ! -x "$REDEVEN_CODE_SERVER_BIN" ]]; then
  echo "Gateway application qualification requires code-server; set REDEVEN_CODE_SERVER_BIN to its executable." >&2
  exit 1
fi
export REDEVEN_CODE_SERVER_BIN
REDEVEN_GATEWAY_ACCESS_BROWSER=1 GOWORK=off go test ./internal/localui -run '^TestGatewayMemberBrowserSession$' -count=1 -timeout=3m -v
