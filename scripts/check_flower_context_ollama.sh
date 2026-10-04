#!/usr/bin/env bash
set -euo pipefail

umask 077
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
SOURCE_STATE_ROOT=${REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT:-$HOME/.redeven/local-environment}

[[ $# -eq 0 ]] || { echo "usage: $0" >&2; exit 2; }
[[ -r "$SOURCE_STATE_ROOT/config.json" ]] || {
  echo "Flower Ollama context qualification requires a readable local config" >&2
  exit 2
}

echo "Running real Flower context qualification with the selected Ollama model in isolated state"
cd "$ROOT_DIR"
REDEVEN_FLOWER_OLLAMA_CONTEXT_E2E=1 \
REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT="$SOURCE_STATE_ROOT" \
GOWORK=off \
  go test ./internal/ai -run '^TestE2E_FlowerOllamaContextCompaction$' -count=1 -timeout 30m -v
