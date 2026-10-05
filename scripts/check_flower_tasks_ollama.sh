#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
SOURCE_STATE_ROOT=${REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT:-$HOME/.redeven/local-environment}
TEST_PATTERN='^TestE2E_FlowerOllamaTaskLifecycle$'
if [[ $# -eq 1 && "$1" == "--interleavings" ]]; then
  TEST_PATTERN+='/interleave_'
elif [[ $# -ne 0 ]]; then
  echo "usage: $0 [--interleavings]" >&2
  exit 2
fi
[[ -r "$SOURCE_STATE_ROOT/config.json" ]] || { echo "A selected local Ollama profile is required" >&2; exit 2; }
cd "$ROOT_DIR"
REDEVEN_FLOWER_OLLAMA_TASK_E2E=1 \
REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT="$SOURCE_STATE_ROOT" \
GOWORK=off go test ./internal/ai -run "$TEST_PATTERN" -count=1 -timeout 60m -v
