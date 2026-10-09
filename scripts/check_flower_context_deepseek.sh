#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
[[ $# -le 1 && ${1:---compaction} == --compaction ]] || { echo "usage: $0 [--compaction]" >&2; exit 2; }
SOURCE_STATE_ROOT=${REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT:-$HOME/.redeven-dev/redeven-1854757905/local-environment}
[[ -r "$SOURCE_STATE_ROOT/config.json" && -r "$SOURCE_STATE_ROOT/secrets.json" ]] || { echo "Readable source config and secrets are required" >&2; exit 2; }
REPORT_DIR=${REDEVEN_FLOWER_COMPACTION_REPORT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/redeven-deepseek-compaction.XXXXXX")}
mkdir -p "$REPORT_DIR"
echo "Running real DeepSeek compaction with production configuration parsing. Reports: $REPORT_DIR"
cd "$ROOT_DIR"
REDEVEN_FLOWER_COMPACTION_E2E=1 \
REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT="$SOURCE_STATE_ROOT" \
REDEVEN_FLOWER_COMPACTION_REPORT_DIR="$REPORT_DIR" \
GOWORK=off go test ./internal/ai -run '^TestE2E_FlowerDeepSeekContextCompaction$' -count=1 -v -timeout 140m | tee "$REPORT_DIR/test.log"
# A skipped or absent lane is never qualification evidence.
for scenario in small_history manual automatic automatic_configured_window; do
  jq -e '.passed == true' "$REPORT_DIR/$scenario/report.json" >/dev/null
 done
