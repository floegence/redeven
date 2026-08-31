#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
SOURCE_STATE_ROOT=${REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT:-$HOME/.redeven/local-environment}
CONFIG_FILE="$SOURCE_STATE_ROOT/config.json"
SECRETS_FILE="$SOURCE_STATE_ROOT/secrets.json"

[[ $# -eq 0 ]] || { echo "usage: $0" >&2; exit 2; }
[[ -r "$CONFIG_FILE" && -r "$SECRETS_FILE" ]] || {
  echo "Flower context qualification requires readable local AI config and secrets" >&2
  exit 2
}

provider_count=$(jq -r '(.ai // .).providers | map(select((.type // "" | ascii_downcase) == "deepseek" and any(.models[]?; .model_name == "deepseek-v4-flash") and any(.models[]?; .model_name == "deepseek-v4-pro"))) | length' "$CONFIG_FILE")
[[ "$provider_count" == "1" ]] || {
  echo "Flower context qualification requires exactly one DeepSeek provider with deepseek-v4-flash and deepseek-v4-pro" >&2
  exit 2
}

provider_id=$(jq -r '(.ai // .).providers[] | select((.type // "" | ascii_downcase) == "deepseek" and any(.models[]?; .model_name == "deepseek-v4-flash") and any(.models[]?; .model_name == "deepseek-v4-pro")) | .id' "$CONFIG_FILE")
base_url=$(jq -r --arg id "$provider_id" '(.ai // .).providers[] | select(.id == $id) | .base_url // ""' "$CONFIG_FILE")
api_key=$(jq -r --arg id "$provider_id" '(.ai // .).provider_api_keys[$id] // empty' "$SECRETS_FILE")
if [[ -z "$api_key" ]]; then
  api_key=$(jq -r --arg id "$provider_id" '.provider_api_keys[$id] // empty' "$SECRETS_FILE")
fi
[[ -n "$api_key" ]] || {
  echo "Flower context qualification could not resolve the configured DeepSeek credential" >&2
  exit 2
}

echo "Running Flower context-prefix, Flash/Pro model-switch, and compaction qualification"
cd "$ROOT_DIR"
REDEVEN_FLOWER_CONTEXT_E2E=1 \
REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL="$base_url" \
REDEVEN_FLOWER_CONTEXT_E2E_API_KEY="$api_key" \
GOWORK=off \
  go test ./internal/ai -run '^TestE2E_FlowerDeepSeekV4(FlashContextCompaction|ContextPrefixAndModelSwitch)$' -count=1 -v
