#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &> /dev/null && pwd)
SOURCE_ROOT="$ROOT_DIR/internal/okf/source"

[ -f "$SOURCE_ROOT/index.md" ] || { echo "missing OKF root index.md" >&2; exit 1; }

CONCEPT_COUNT=$(find "$SOURCE_ROOT" -type f -name "*.md" ! -name "index.md" ! -name "log.md" | wc -l | tr -d " ")
if [ "$CONCEPT_COUNT" -lt 1 ]; then
  echo "no OKF concepts found" >&2
  exit 1
fi

(
  cd "$ROOT_DIR"
  go run ./cmd/okf-bundle --source-root "$SOURCE_ROOT" --validate-source-only >/dev/null
)
