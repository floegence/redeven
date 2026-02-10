#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

WORKSPACE_PATH="${1:-/Users/tangjianyin/Downloads/code/openclaw}"
REPORT_DIR="${2:-}"
TOP_K="${TOP_K:-6}"
MAX_VARIANTS="${MAX_VARIANTS:-0}"

cd "$ROOT_DIR"

ARGS=(
  --workspace "$WORKSPACE_PATH"
  --top-k "$TOP_K"
  --max-variants "$MAX_VARIANTS"
)

if [[ -n "$REPORT_DIR" ]]; then
  ARGS+=(--report-dir "$REPORT_DIR")
fi

echo "[eval] workspace=$WORKSPACE_PATH top_k=$TOP_K max_variants=$MAX_VARIANTS"
go run ./cmd/ai-loop-eval "${ARGS[@]}"
