#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &> /dev/null && pwd)
MODE="report"
JSON=0

for arg in "$@"; do
  case "$arg" in
    --report-only) MODE="report" ;;
    --strict) MODE="strict" ;;
    --json) JSON=1 ;;
    *) echo "Error: unknown arg: $arg" >&2; exit 1 ;;
  esac
done

(
  cd "$ROOT_DIR"
  ARGS=(
    --source-root "$ROOT_DIR/okf"
    --validate-source-only
    --quality-mode "$MODE"
  )
  if [ "$JSON" -eq 1 ]; then
    ARGS+=(--quality-json)
  fi
  env GOWORK=off go run ./cmd/okf-bundle \
    "${ARGS[@]}"
)
