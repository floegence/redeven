#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

WORKSPACE_PATH="${1:-/Users/tangjianyin/Downloads/code/openclaw}"
REPORT_DIR="${2:-}"
TASK_SPEC_PATH="${TASK_SPEC_PATH:-$ROOT_DIR/eval/tasks/default.yaml}"
BASELINE_PATH="${BASELINE_PATH:-$ROOT_DIR/eval/baselines/open_source_best.json}"

cd "$ROOT_DIR"

echo "[gate] replay fixtures"
go run ./cmd/ai-loop-replay --message-log "$ROOT_DIR/eval/replay_cases/loop_exhausted_fail.message.log.json" --expect fail
go run ./cmd/ai-loop-replay --message-log "$ROOT_DIR/eval/replay_cases/normal_pass.message.log.json" --expect pass

echo "[gate] evaluate behavioral suite with hard gate"
ARGS=(
  --workspace "$WORKSPACE_PATH"
  --task-spec "$TASK_SPEC_PATH"
  --baseline "$BASELINE_PATH"
  --enforce-gate
)

if [[ -n "$REPORT_DIR" ]]; then
  ARGS+=(--report-dir "$REPORT_DIR")
fi

go run ./cmd/ai-loop-eval "${ARGS[@]}"
