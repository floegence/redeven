#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
cd "$ROOT_DIR"
node desktop/scripts/check-gateway-deployment.mjs
