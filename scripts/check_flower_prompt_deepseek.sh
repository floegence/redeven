#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
SOURCE_STATE_ROOT=${REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT:-$HOME/.redeven-dev/redeven-1854757905/local-environment}
[[ -r "$SOURCE_STATE_ROOT/config.json" && -r "$SOURCE_STATE_ROOT/secrets.json" ]] || { echo "Readable source config and secrets are required" >&2; exit 2; }
SOURCE_DIGEST=$(shasum -a 256 "$SOURCE_STATE_ROOT/config.json" "$SOURCE_STATE_ROOT/secrets.json")
verify_source_unchanged() {
  local status=$?
  if [[ "$SOURCE_DIGEST" != "$(shasum -a 256 "$SOURCE_STATE_ROOT/config.json" "$SOURCE_STATE_ROOT/secrets.json")" ]]; then
    echo "Source configuration changed during qualification" >&2
    status=1
  fi
  exit "$status"
}
trap verify_source_unchanged EXIT
REPORT_DIR=${REDEVEN_FLOWER_PROMPT_REPORT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/redeven-deepseek-prompt.XXXXXX")}
mkdir -p "$REPORT_DIR"
[[ -z "$(find "$REPORT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "Report directory must be empty" >&2; exit 2; }
REPEATS=${REDEVEN_FLOWER_PROMPT_REPEATS:-3}
[[ "$REPEATS" =~ ^[1-5]$ ]] || { echo "Repeats must be 1..5" >&2; exit 2; }
cd "$ROOT_DIR"
echo "Real configured DeepSeek flash prompt qualification. Reports: $REPORT_DIR"
REDEVEN_FLOWER_PROMPT_E2E=1 \
REDEVEN_FLOWER_PROMPT_REPEATS="$REPEATS" \
REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT="$SOURCE_STATE_ROOT" \
REDEVEN_FLOWER_PROMPT_REPORT_DIR="$REPORT_DIR" \
GOWORK=off go test ./internal/ai -run '^TestE2E_FlowerPromptDeepSeek(Runtime)?$' -count=1 -parallel 3 -v -timeout 30m | tee "$REPORT_DIR/test.log"
# An absent, skipped, empty or failed qualification is not a passing run.
python3 - "$REPORT_DIR" "$REPEATS" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text())
repeats = int(sys.argv[2])
assert manifest['repeats'] == repeats, 'repetition count changed'
cases = manifest['cases']
assert cases and len(cases) == len(set(cases)), 'invalid case manifest'
expected = {root / case / str(i) / 'report.json' for case in cases for i in range(1, repeats + 1)}
reports = set(root.glob('*/*/report.json'))
assert reports == expected, 'incomplete qualification'
assert all(json.loads(p.read_text())['passed'] for p in reports), 'failed qualification'
assert json.loads((pathlib.Path(sys.argv[1]) / 'runtime/report.json').read_text())['passed'], 'runtime qualification failed'
print(f'Passed {len(reports)} real-provider behavior cases')
PY
