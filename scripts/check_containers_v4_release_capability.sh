#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
SOURCE_CONTRACT="$ROOT_DIR/spec/capabilities/container-resources-v4.contract.json"
HOST_PROJECTION="$ROOT_DIR/spec/redevplugin/known-containers-capability-v4.contract.json"

node "$ROOT_DIR/scripts/build_containers_v4_contract.mjs" --verify
cmp "$SOURCE_CONTRACT" "$HOST_PROJECTION"

for retired in \
  "$ROOT_DIR/spec/redevplugin/candidate-containers-capability" \
  "$ROOT_DIR/spec/redevplugin/official-containers-capability" \
  "$ROOT_DIR/spec/redevplugin/official-containers-capability-v4"
do
  if [[ -e "$retired" ]]; then
    echo "retired independent capability publisher asset remains: $retired" >&2
    exit 1
  fi
done

GOWORK=off GOTOOLCHAIN=go1.26.6+auto go test ./spec/redevplugin -run 'TestContainersCapabilityContract' -count=1

echo "Containers v4 known capability contract verified"
