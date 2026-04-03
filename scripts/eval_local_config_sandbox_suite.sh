#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

WORKSPACE_PATH="${1:-$ROOT_DIR}"
REPORT_DIR="${2:-}"
TASK_SPEC_PATH="${TASK_SPEC_PATH:-$ROOT_DIR/eval/tasks/local_config_sandbox.yaml}"
BASELINE_PATH="${BASELINE_PATH:-}"
ENFORCE_GATE="${ENFORCE_GATE:-0}"

cd "$ROOT_DIR"

ARGS=(
  --workspace "$WORKSPACE_PATH"
  --task-spec "$TASK_SPEC_PATH"
  --baseline "$BASELINE_PATH"
)

if [[ -n "$REPORT_DIR" ]]; then
  ARGS+=(--report-dir "$REPORT_DIR")
fi

if [[ "$ENFORCE_GATE" == "1" ]]; then
  ARGS+=(--enforce-gate)
fi

echo "[eval-local-config] workspace=$WORKSPACE_PATH task_spec=$TASK_SPEC_PATH enforce_gate=$ENFORCE_GATE"
echo "[eval-local-config] model source=current local Flower config (for example your active Kimi setup)"
go run ./cmd/ai-loop-eval "${ARGS[@]}"
