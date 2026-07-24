#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_plugin_integration.sh [--ci]

Runs the current Redeven-side ReDevPlugin integration gate. This gate checks the
published-dependency boundary, release artifact consumer guards, AppServer and
Local UI origin isolation, mounted released-handler delegation, session/security
adapters, and Redeven-owned Containers capability adapter contracts.

It must not consume unreleased ReDevPlugin routes, local sibling checkouts,
copied contracts, or local runtime binaries.
USAGE
}

mode="${1:---ci}"
case "$mode" in
  --ci)
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

cd "$ROOT_DIR"
export GOWORK=off

log() {
  echo "[INFO] $*"
}

require_embedded_assets() {
  local missing=()
  for dir in internal/envapp/ui/dist internal/codeapp/ui/dist; do
    if [ ! -d "$dir" ]; then
      missing+=("$dir")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  echo "missing embedded UI assets required by Go embed tests:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Run ./scripts/build_assets.sh before ./scripts/check_plugin_integration.sh --ci." >&2
  exit 1
}

log "checking ReDevPlugin published dependency boundary"
./scripts/check_redevplugin_dependency_boundary.sh --ci

log "checking immutable catalog plugin package URL"
node ./scripts/check_catalog_plugin_package_url.mjs

log "checking controlled release archive extraction"
python3 -c 'from pathlib import Path; [compile(Path(name).read_text(encoding="utf-8"), name, "exec") for name in ("scripts/safe_extract_tar.py", "scripts/extract_desktop_runtime.py")]'
./scripts/safe_extract_tar.py --self-test
./scripts/extract_desktop_runtime.py --self-test
node --check scripts/collect_release_artifacts.mjs
node --test scripts/collect_release_artifacts.test.mjs

log "checking ReDevPlugin release artifact verifier fixture"
./scripts/check_redevplugin_release_artifacts.sh --self-test

log "checking ReDevPlugin consumption gate fixture"
./scripts/check_redevplugin_consumption_gate.sh --self-test

log "checking ReDevPlugin artifact staging fixture"
./scripts/stage_redevplugin_release_artifacts.sh --self-test

log "checking AppServer and Local UI plugin route isolation and delegation"
require_embedded_assets
go test ./internal/codeapp/appserver \
	-run 'TestServer_(ProxyOriginRouteMatrix|PluginManagementAPINamespaceReserved|PluginManagementAPIDelegatesToPluginPlatform|PluginNamespaceRouteMatrix|PluginNamespaceDelegatesToPluginPlatformForPluginOrigin|PluginOriginCannotAccessManagementSurfaces)$' \
	-count=1
go test ./internal/localui \
	-run 'TestServer_(PluginManagementAPINamespaceReserved|PluginManagementAPIUsesAccessGateWhenPlatformEnabled|PluginNamespaceRouteMatrix|handlePluginNamespace_ForwardsWithoutEnvRouteOverride)$' \
	-count=1

log "checking ReDevPlugin session, security, runtime, and route adapters"
go test ./internal/redevpluginintegration -count=1

log "checking Containers capability adapter and fixture contracts"
go test ./internal/capabilities/containers -count=1

log "ReDevPlugin integration gate passed"
