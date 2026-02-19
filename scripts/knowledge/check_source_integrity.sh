#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &> /dev/null && pwd)
SOURCE_ROOT="$ROOT_DIR/internal/knowledge/source"

search_pattern() {
  local pattern="$1"
  local target="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$target" >/dev/null 2>&1
    return $?
  fi
  grep -R -n -E "$pattern" "$target" >/dev/null 2>&1
}

[ -f "$SOURCE_ROOT/manifest.yaml" ] || { echo "missing source manifest.yaml" >&2; exit 1; }
[ -f "$SOURCE_ROOT/indices/topic_index.yaml" ] || { echo "missing topic_index.yaml" >&2; exit 1; }
[ -f "$SOURCE_ROOT/indices/code_index.yaml" ] || { echo "missing code_index.yaml" >&2; exit 1; }

CARD_COUNT=$(find "$SOURCE_ROOT/cards" -maxdepth 1 -type f -name "*.md" | wc -l | tr -d " ")
if [ "$CARD_COUNT" -lt 1 ]; then
  echo "no source cards found" >&2
  exit 1
fi

if search_pattern "^[[:space:]]*-[[:space:]]*redeven[[:space:]]*:" "$SOURCE_ROOT/manifest.yaml"; then
  echo "manifest allowed_repos must not include redeven" >&2
  exit 1
fi
if search_pattern "^[[:space:]]*redeven/" "$SOURCE_ROOT/indices/code_index.yaml"; then
  echo "code index must not include redeven paths" >&2
  exit 1
fi
if search_pattern "^[[:space:]]*-[[:space:]]*redeven:" "$SOURCE_ROOT/cards"; then
  echo "cards evidence must not include redeven repo" >&2
  exit 1
fi

go run ./cmd/knowledge-bundle --source-root "$SOURCE_ROOT" --validate-source-only >/dev/null
