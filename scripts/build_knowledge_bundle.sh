#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)
VERIFY_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --verify-only)
      VERIFY_ONLY=1
      ;;
    *)
      echo "Error: unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

SOURCE_ROOT="$ROOT_DIR/internal/knowledge/source"
DIST_ROOT="$ROOT_DIR/internal/knowledge/dist"

if [ "$VERIFY_ONLY" -eq 1 ]; then
  go run ./cmd/knowledge-bundle \
    --source-root "$SOURCE_ROOT" \
    --dist-root "$DIST_ROOT" \
    --verify-only
else
  go run ./cmd/knowledge-bundle \
    --source-root "$SOURCE_ROOT" \
    --dist-root "$DIST_ROOT"
fi
