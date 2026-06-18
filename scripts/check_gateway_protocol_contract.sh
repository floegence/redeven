#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

cd "$ROOT_DIR"

go test ./internal/runtimegateway/protocol -run 'TestGateway(OpenAPIContract|NamingBoundary)' -count=1
