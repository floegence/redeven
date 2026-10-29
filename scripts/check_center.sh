#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"
[[ "$(node --version)" == "v$(cat .node-version)" ]] || { echo "Use the repository Node version." >&2; exit 2; }
node --test scripts/check_center_source_contract.test.mjs
GOWORK=off go run ./cmd/center-contracts --check
GOWORK=off go test ./cmd/redeven-center ./internal/environmentcenter ./internal/webbinding ./internal/webconnector ./internal/accessgate -count=1
corepack pnpm --dir desktop exec tsc -p tsconfig.center.json --noEmit
corepack pnpm --dir desktop exec vitest run tests/envCenterContract.test.ts tests/centerCatalog.test.ts
if [[ "${1:-}" == "--contracts-only" ]]; then
  exit 0
fi
corepack pnpm --dir desktop exec vite build --config vite.center.config.mjs
if [[ "${1:-}" == "--browser" ]]; then
  # Use the same native terminal engine as the shipped Runtime.
  for browser in chromium firefox webkit; do
    REDEVEN_CENTER_BROWSER=1 REDEVEN_CENTER_BROWSER_ENGINE="$browser" \
      GOWORK=off go test -tags=floeterm_native ./internal/localui \
      -run '^TestCenterBrowserQualification$' -count=1 -timeout=6m -v
  done
fi
