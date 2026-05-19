#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

if ! command -v docker >/dev/null 2>&1; then
  echo "docker runtime e2e failed: docker is not installed or not on PATH" >&2
  exit 1
fi

if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "docker runtime e2e failed: docker daemon is not available" >&2
  exit 1
fi

if [ ! -d "$ROOT_DIR/internal/envapp/ui/dist" ] || [ ! -d "$ROOT_DIR/internal/codeapp/ui/dist" ]; then
  "$ROOT_DIR/scripts/build_assets.sh"
fi

(
  cd "$ROOT_DIR"
  go test -tags docker_e2e -count=1 ./tests/docker_runtime_e2e
)
