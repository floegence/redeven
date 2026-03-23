#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

WORKSPACE_PATH="${1:-/Users/tangjianyin/Downloads/code/openclaw}"
REPORT_DIR="${2:-}"
TASK_SPEC_PATH="${TASK_SPEC_PATH:-$ROOT_DIR/eval/tasks/default.yaml}"
BASELINE_PATH="${BASELINE_PATH:-$ROOT_DIR/eval/baselines/open_source_best.json}"
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

echo "[eval] workspace=$WORKSPACE_PATH behavioral_suite=1 enforce_gate=$ENFORCE_GATE"
go run ./cmd/ai-loop-eval "${ARGS[@]}"
