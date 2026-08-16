#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
cd "$ROOT_DIR"

if [ "${1:-}" != "" ] && [ "${1:-}" != "--ci" ]; then
  echo "usage: ./scripts/check_floret_dependency_boundary.sh [--ci]" >&2
  exit 2
fi

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

require_source() {
  local file=$1
  local marker=$2
  rg -Fq "$marker" "$file" || fail "$file is missing required Floret v4 boundary: $marker"
}

echo "[INFO] checking published Floret v4 dependency"
rg -q '^\s*github\.com/floegence/floret/v4 v4\.0\.9$' go.mod \
  || fail "go.mod must consume github.com/floegence/floret/v4 v4.0.9"
if rg -n '^replace .*floegence/floret|github\.com/floegence/floret/v4\s*=>' go.mod; then
  fail "Floret must not use a Go module replacement"
fi
for workspace in go.work go.work.sum; do
  [ ! -e "$workspace" ] || fail "$workspace is temporary local wiring and must be removed"
done
if rg -n --glob 'go.mod' --glob 'package.json' --glob '*lock*' \
  '(file:(/|\.)|link:(/|\.)|workspace:|portal:|\.\./floret|/floret-flower-simplification)' .; then
  fail "published dependency manifests must not contain sibling wiring"
fi

echo "[INFO] checking public imports and storage ownership"
if rg -n --glob '*.go' --glob '!**/*_test.go' \
  'github\.com/floegence/floret(?:"$|/v[0-3](?:/|"$))' internal cmd; then
  fail "production must import only the Floret v4 module"
fi
if rg -n --glob '*.go' --glob '!**/*_test.go' \
  'github\.com/floegence/floret/v4/internal/' internal cmd; then
  fail "Redeven must not import Floret internals"
fi
if rg -n --glob '*.go' --glob '!**/*_test.go' \
  'CREATE TABLE floret_|INSERT INTO floret_|UPDATE floret_|DELETE FROM floret_' internal cmd; then
  fail "Redeven must not access Floret-owned schema"
fi

echo "[INFO] checking typed ThreadService production path"
require_source internal/ai/floret_bootstrap.go 'host.ThreadService(effects)'
require_source internal/ai/floret_bootstrap.go 'threadRuntime flruntime.ThreadService'
require_source internal/ai/send_user_turn.go 's.threadRuntime.Send'
require_source internal/ai/stop_thread.go 'typed.Cancel'
require_source internal/ai/approval_command.go '.Respond('
require_source internal/ai/retry_thread_continuation.go '.Retry('
require_source internal/ai/retry_thread_effect.go '.RetryEffect('
require_source internal/ai/service.go 's.threadRuntime.Subscribe'
require_source internal/ai/floret_runtime.go 'floretEffectAuthorizationGateForRun'
require_source internal/ai/subagents_floret.go 'ThreadScope{ParentID:'

legacy_pattern='TurnAdmissionReceipt|ExecuteAdmission|AdmitTurn|authority.?barrier|RecoveryHandle|ProjectionDelta|PendingToolRecovery|approval.?generation|admission.?handoff|receipt.?observation'
if rg -n -i --pcre2 --glob '*.go' --glob '!**/*_test.go' "$legacy_pattern" internal/ai; then
  fail "Redeven production retains a removed Floret lifecycle path"
fi

echo "[INFO] checking one workspace live transport and bounded UI state"
require_source internal/ai/flower_live_stream.go 'FlowerLiveStreamReady'
require_source desktop/src/main/main.ts "{ path: '/_redeven_proxy/api/ai/flower/stream', methods: ['GET'] }"
require_source internal/flower_ui/src/threadCache.ts 'createThreadCache'
require_source internal/flower_ui/src/liveTransport.ts 'connectionEpoch'
require_source internal/flower_ui/src/transportOutbox.ts 'createTransportOutbox'
ui_legacy_pattern='approvalDecisionHandoff|consumedInputAdmissions|selectedThreadDetailID|sidebarActiveThreadID|loadingThreadID|pendingSubmission|threadStopping|continuationRetryingThreadID|thread_generation|summary_generation|retention_gap|replay_cursor|event_cursor'
if rg -n --pcre2 --glob '*.{ts,tsx}' --glob '!**/*test*' "$ui_legacy_pattern" \
  internal/flower_ui/src desktop/src/welcome/flower internal/envapp/ui_src/src/ui/flower; then
  fail "Flower production retains a removed local lifecycle or replay state"
fi

echo "[INFO] checking product schema boundary"
GOWORK=off go run ./internal/cmd/threadstore-boundary-contract --check --root .
GOWORK=off go test ./internal/ai/threadstore ./internal/boundarycontract -count=1

echo "[INFO] Floret v4 dependency boundary passed"
