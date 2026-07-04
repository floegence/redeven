#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_plugin_integration.sh [--ci]

Runs the current Redeven-side ReDevPlugin integration readiness gate. This gate
checks the published-dependency boundary, release artifact consumer guards,
existing AppServer origin isolation, and Redeven-owned Containers capability
adapter contracts.

It is intentionally a pre-release integration gate: it must not mount or consume
unreleased ReDevPlugin routes, local sibling checkouts, copied contracts, or
runtime binaries.
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

log "checking ReDevPlugin published dependency boundary"
./scripts/check_redevplugin_dependency_boundary.sh --ci

log "checking ReDevPlugin release artifact verifier fixture"
./scripts/check_redevplugin_release_artifacts.sh --self-test

log "checking ReDevPlugin consumption gate fixture"
./scripts/check_redevplugin_consumption_gate.sh --self-test

log "checking ReDevPlugin artifact staging fixture"
./scripts/stage_redevplugin_release_artifacts.sh --self-test

log "checking AppServer and Local UI plugin origin isolation matrix"
go test ./internal/codeapp/appserver \
	-run 'TestServer_(ProxyOriginRouteMatrix|PluginManagementAPINamespaceReserved|PluginNamespaceRouteMatrix|PluginOriginCannotAccessManagementSurfaces)$' \
	-count=1
go test ./internal/localui \
	-run 'TestServer_(PluginNamespaceRouteMatrix|handlePluginNamespace_ForwardsWithoutEnvRouteOverride)$' \
	-count=1

log "checking Containers capability adapter and fixture contracts"
go test ./internal/capabilities/containers -count=1

log "ReDevPlugin integration readiness gate passed"
