#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# The application suite proves Runtime exposes no TCP listeners. The network
# suite proves the same mandatory Gateway path under OS egress isolation.
bash scripts/check_gateway_access_browser.sh
bash scripts/check_gateway_cloud_isolation.sh
