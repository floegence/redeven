#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  ./scripts/check_floret_dependency_boundary.sh [--ci]

Checks that Redeven consumes Floret only through the published public runtime
module and does not inspect or patch Floret-owned storage internals.
USAGE
}

mode="${1:---ci}"
case "$mode" in
  --ci)
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
PARENT_DIR=$(cd -- "$ROOT_DIR/.." &> /dev/null && pwd)

cd "$ROOT_DIR"
export GOWORK=off

if ! command -v rg >/dev/null 2>&1; then
  echo "[ERROR] rg is required but not found in PATH." >&2
  exit 1
fi

failed=0

fail() {
  echo "[ERROR] $*" >&2
  failed=1
}

check_no_go_workspace_files() {
  local found=0

  while IFS= read -r -d '' workspace_file; do
    found=1
    fail "Go workspace file is forbidden in this repository: ${workspace_file#$ROOT_DIR/}"
  done < <(find "$ROOT_DIR" -type f \( -name go.work -o -name go.work.sum \) -print0)

  for workspace_file in "$PARENT_DIR/go.work" "$PARENT_DIR/go.work.sum"; do
    if [ -e "$workspace_file" ]; then
      found=1
      fail "Go workspace file is forbidden in the shared parent directory: $workspace_file"
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "[INFO] no Go workspace files found"
  fi
}

check_go_module_boundary() {
  local matches

  if matches=$(rg -n --pcre2 'github\.com/floegence/floret[^\n]*=>[[:space:]]*(\.{1,2}/|/|file:|[A-Za-z]:)' go.mod go.sum 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Floret must not be wired through a local Go replace target."
  fi

  if matches=$(rg -n --pcre2 '^\s*replace\s+github\.com/floegence/floret\b' go.mod 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Floret Go module replacements are forbidden in Redeven."
  fi

  if rg -q --pcre2 '"github\.com/floegence/floret(/[^"]*)?"' --glob '*.go' .; then
    if ! rg -q --pcre2 '^\s*github\.com/floegence/floret\s+v[0-9]+\.[0-9]+\.[0-9]+' go.mod; then
      fail "Go source imports Floret but go.mod does not require a published semver module."
    fi
  fi

  echo "[INFO] Go module boundary checked"
}

check_local_source_wiring() {
  local matches
  local scan_paths=()

  for candidate in .github scripts cmd internal desktop go.mod go.sum package.json package-lock.json pnpm-lock.yaml; do
    if [ -e "$candidate" ]; then
      scan_paths+=("$candidate")
    fi
  done

  if [ "${#scan_paths[@]}" -gt 0 ] && matches=$(rg -n --pcre2 --glob '!scripts/check_floret_dependency_boundary.sh' '(?i)(\.\./floret(?:/|$)|(?:^|[[:space:]"'"'"'(:=])/(?:[^\n[:space:]"'"'"']+/)*floret(?:/|$)|file:[^\n]*floret|link:[^\n]*floret|workspace:[^\n]*floret|portal:[^\n]*floret)' "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Build, script, and source files must not point at a local Floret checkout."
  fi

  echo "[INFO] local source wiring checked"
}

check_no_floret_internal_imports() {
  local matches

  if matches=$(rg -n --pcre2 '"github\.com/floegence/floret/internal(?:/[^"]*)?"' --glob '*.go' . 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven must not import Floret internal packages."
  fi

  echo "[INFO] Floret internal import boundary checked"
}

check_no_floret_schema_access() {
  local matches
  local scan_paths=()

  for candidate in internal scripts .github; do
    if [ -e "$candidate" ]; then
      scan_paths+=("$candidate")
    fi
  done

  if [ "${#scan_paths[@]}" -eq 0 ]; then
    echo "[INFO] no source paths found for Floret schema scan"
    return
  fi

  local floret_schema_pattern='active_turn_leases|schema_meta|raw_encoder_version|provider_states|agent_todo_states|prompt_segments|prompt_toolsets|prompt_requests|prompt_responses|tool_output_artifacts|metadata_records'
  local floret_raw_sql_pattern='(?i)(CREATE[[:space:]]+TABLE|ALTER[[:space:]]+TABLE|DROP[[:space:]]+TABLE|INSERT[[:space:]]+INTO|UPDATE|DELETE[[:space:]]+FROM|FROM|JOIN)[[:space:]]+(schema_meta|fork_operations|threads|entries|provider_states|agent_todo_states|prompt_segments|prompt_toolsets|prompt_requests|prompt_responses|tool_output_artifacts|metadata_records|active_turn_leases)\b'

  if matches=$(rg -n --pcre2 --glob '!scripts/check_floret_dependency_boundary.sh' --glob '!internal/session/dependency_contract_test.go' "$floret_schema_pattern" "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven must not reference Floret-owned storage schema tables or columns."
  fi

  if matches=$(rg -n --pcre2 --glob '!scripts/check_floret_dependency_boundary.sh' "$floret_raw_sql_pattern" "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven must not execute raw SQL against Floret-owned tables."
  fi

  if matches=$(rg -n --pcre2 --glob '!scripts/check_floret_dependency_boundary.sh' --glob '!internal/ai/floret_runtime.go' --glob '!internal/ai/subagent_lifecycle_test.go' --glob '!internal/codeapp/appserver/*_test.go' --glob '!internal/codeapp/codeapp_migration_test.go' 'floret_threads\.sqlite|floret_subagents\.sqlite' "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Floret store file names may only appear in the public runtime store path adapter or scoped integration tests."
  fi

  echo "[INFO] Floret storage schema boundary checked"
}

check_no_agent_shadow_storage() {
  local matches
  local shadow_pattern='ai_messages|ai_runs|ai_tool_calls|ai_run_events|execution_spans|ai_thread_state|ai_thread_todos|ai_thread_checkpoints|transcript_messages|conversation_turns|memory_items|memory_embeddings|structured_user_inputs|request_user_input_secret_answers|ai_delegated_approval_(requests|events|outbox|idempotency)'

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/testutil/legacydb/**' \
    --glob '!internal/ai/threadstore/schema.go' \
    "$shadow_pattern" internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven production code must not define, query, or persist Agent shadow conversation state."
  fi

  echo "[INFO] Agent shadow storage boundary checked"
}

check_floret_capability_bootstrap_boundary() {
	local matches file alias

	while IFS= read -r file; do
		alias=$(sed -nE 's/^[[:space:]]*([[:alnum:]_]+)[[:space:]]+"github\.com\/floegence\/floret\/runtime".*/\1/p' "$file" | head -n 1)
		if [ -z "$alias" ]; then
			alias=runtime
		fi
		if matches=$(rg -n --pcre2 "${alias}\\.(NewHostBootstrap|NewTurnExecutionHostFactory|NewThreadCreateHost)\\b" "$file" 2>/dev/null); then
			printf '%s\n' "$matches"
			fail "Removed store-wide Floret capability constructors must not be used in production or test code."
		fi
		case "$file" in
			*_test.go|internal/ai/floret_bootstrap.go)
				continue
				;;
		esac
		if matches=$(rg -n --pcre2 "${alias}\\.(OpenSQLiteStore|ConfigureHostCapabilities|New(Thread(Read|Create|Title|Fork|Delete)HostBinder|TurnExecutionHostBinder|ThreadCompactionHostBinder|SubAgentHostBinder|SubAgentReadHostBinder|InterruptedTurnRecoveryHostBinder|PendingToolRecoveryHostBinder))|\\b${alias}\\.(Store|HostBootstrap)\\b|\\*${alias}\\.(TurnExecutionHost|ThreadCompactionHost|SubAgentHost|Thread(Read|Create|Title|Fork|Delete)Host|SubAgentReadHost|InterruptedTurnRecoveryHost|PendingToolRecoveryHost|Thread(Read|Create|Title|Fork|Delete)HostBinder|TurnExecutionHostBinder|ThreadCompactionHostBinder|SubAgentHostBinder|SubAgentReadHostBinder|InterruptedTurnRecoveryHostBinder|PendingToolRecoveryHostBinder)" "$file" 2>/dev/null); then
			printf '%s\n' "$matches"
			fail "Raw Floret runtime tokens, concrete hosts, and capability constructors must stay in floret_bootstrap.go."
		fi
	done < <(rg -l --glob '*.go' '"github\.com/floegence/floret/runtime"' internal 2>/dev/null)

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    'NewPendingToolRecoveryHostBinder|PendingToolRecoveryHost' \
    internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven has no durable host process state to justify Floret pending-tool recovery authority."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/floret_bootstrap.go' \
    --glob '!internal/ai/floret_contracts.go' \
    --glob '!internal/ai/floret_startup_recovery.go' \
    'InterruptedTurnRecovery' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Interrupted-turn recovery capability must stay inside bootstrap and the startup recovery coordinator."
  fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		'(service|Service)[[:space:]]+\*Service|\bservice[[:space:]]*\*Service' \
    internal/ai/run.go internal/ai/floret_*.go internal/ai/subagents_floret.go 2>/dev/null); then
    printf '%s\n' "$matches"
		fail "A runtime object must not retain the full Redeven Service capability set."
	fi

	if matches=$(rg -n --pcre2 \
		'\*threadstore\.Store|\bthreadsDB\b|CreateThreadSettings|PrepareForkOperation|PrepareThreadDeleteOperation|CommitThreadCreateSettings|CommitForkOperation' \
		internal/ai/run.go 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "A run must retain only the exact runProductCapabilities allowlist, never the full product store or lifecycle coordinators."
	fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		--glob '!internal/ai/floret_bootstrap.go' \
		'floretBootstrapResult' \
		internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "The aggregate Floret bootstrap result must not escape the composition root."
	fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		'(floret|Floret)[[:space:]]+\*floret|floretRuntimeAdapter' \
		internal/ai/service.go internal/ai/run_host_capabilities.go 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Service and run objects must not retain an aggregate Floret capability adapter."
	fi

	if matches=$(rg -n --pcre2 \
		'floretThread(Create|Title|Fork|Delete)Authority|floretThreadRuntimeBinder|floret(ThreadRead|SubagentRead)HostFactory' \
		internal/ai/service.go 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Service must retain only purpose-specific Floret capability owners, never raw authorities or binders."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' --glob '!internal/ai/thread_create_operation.go' \
		'threadCreateFloret' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Floret create capability escaped the durable create coordinator."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' --glob '!internal/ai/threads.go' \
		'threadTitleFloret' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Floret title capability escaped explicit rename coordination."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' --glob '!internal/ai/thread_fork_operation.go' \
		'threadForkFloret' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Floret fork capability escaped the durable fork coordinator."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' --glob '!internal/ai/thread_delete_operation.go' \
		'threadDeleteFloret' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Floret delete capability escaped the durable delete coordinator."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' --glob '!internal/ai/subagent_publication_recovery.go' \
		'floretRuntime\.bindThread\(' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "The arbitrary-thread Floret runtime issuer escaped normal run binding or exact publication recovery."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/service.go' \
		'floretReads\.(openThread|openSubagent)\(' internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Floret canonical read issuance must stay behind Service read methods."
	fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		'newFloretThread(Create|Delete|Fork|Title)|InterruptedTurnRecovery|floretBootstrapResult' \
		internal/ai/run_host_capabilities.go 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Per-run host capabilities must not contain lifecycle or recovery authority."
	fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		'subagentChildRun\(runHostCapabilities\{\}\)|childHost[[:space:]]*:=[[:space:]]*host' \
		internal/ai 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Executable SubAgent runs must receive exact child resources and must not copy the root capability bundle."
	fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    'fltools\.(Approver|ApprovalRequest|PermissionDecision)|flruntime\.(Approver|ApprovalRequest|PermissionDecision)|CloseSubAgents|SubAgentMaintenance|PendingToolSettlementHost' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Removed approval, bulk SubAgent maintenance, or standalone settlement capabilities must not return."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/thread_create_operation.go' \
    --glob '!internal/ai/service.go' \
    'openFloretThreadCreateHost\(' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Only the durable create coordinator may receive Floret thread creation capability."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/thread_create_operation.go' \
    --glob '!internal/ai/thread_fork_operation.go' \
    --glob '!internal/ai/threads.go' \
    --glob '!internal/ai/service.go' \
    'openFloretThreadTitleHost\(' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Floret title capability escaped create, fork, or explicit rename coordination."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/thread_fork_operation.go' \
    --glob '!internal/ai/service.go' \
    'openFloretForkHost\(' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Only the durable fork coordinator may receive Floret fork capability."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/thread_delete_operation.go' \
    --glob '!internal/ai/service.go' \
    'openFloretThreadDeleteHost\(' \
    internal/ai 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Only the durable delete coordinator may receive Floret delete capability."
  fi

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/floret_bootstrap.go' \
    'flruntime\.(ForkedTurnRef|SubAgentDetailEvents|ProjectThreadTurn)|ThreadTitleModeHostOwned' \
    internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven production code must not consume duplicate or host-owned Floret authority paths."
  fi

  echo "[INFO] Floret capability bootstrap boundary checked"
}

check_floret_thread_creation_boundary() {
  local matches file alias

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/floret_contracts.go' \
    --glob '!internal/ai/floret_bootstrap.go' \
    --glob '!internal/ai/thread_create_operation.go' \
    'flruntime\.CreateThreadRequest|\.CreateThread\([^\n]*flruntime\.CreateThreadRequest' \
    internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Only the durable thread create coordinator may create a canonical Floret thread."
  fi

  while IFS= read -r file; do
    alias=$(sed -nE 's/^[[:space:]]*([[:alnum:]_]+)[[:space:]]+"github\.com\/floegence\/floret\/runtime".*/\1/p' "$file" | head -n 1)
    if [ -z "$alias" ]; then
      alias=runtime
    fi
    if matches=$(rg -n --pcre2 "${alias}\\.StartThreadRequest" "$file" 2>/dev/null); then
      printf '%s\n' "$matches"
      fail "Removed Floret StartThread creation capability must not be reintroduced."
    fi
    case "$file" in
      internal/ai/floret_contracts.go|internal/ai/floret_bootstrap.go|internal/ai/thread_create_operation.go)
        ;;
      *)
        if matches=$(rg -n --pcre2 "${alias}\\.CreateThreadRequest" "$file" 2>/dev/null); then
          printf '%s\n' "$matches"
          fail "Only the durable thread create coordinator may hold the Floret creation request, regardless of import alias."
        fi
        ;;
    esac
  done < <(rg -l --glob '*.go' --glob '!**/*_test.go' '"github\.com/floegence/floret/runtime"' internal 2>/dev/null)

  if matches=$(rg -n --pcre2 \
    --glob '*.go' \
    --glob '!**/*_test.go' \
    --glob '!internal/ai/floret_contracts.go' \
    --glob '!internal/ai/floret_bootstrap.go' \
    --glob '!internal/ai/service.go' \
    --glob '!internal/ai/thread_create_operation.go' \
    'floretThreadCreateHost|openFloretThreadCreateHost' \
    internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Floret thread creation capability must not escape the create coordinator boundary."
  fi

  if matches=$(rg -n --pcre2 --glob '!**/*_test.go' --glob '!scripts/check_floret_dependency_boundary.sh' 'EnsureThread|EnsureThreadRequest|floret_ensured|FloretEnsured' internal scripts okf 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Removed implicit Floret thread ensure/recovery contracts must not be reintroduced."
  fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		'\.CreateThreadSettings\(' \
		internal 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Production code must create thread settings only through the durable create coordinator."
	fi

	if matches=$(rg -n --pcre2 \
		--glob '*.go' \
		--glob '!**/*_test.go' \
		--glob '!internal/ai/thread_create_operation.go' \
		'\.(ConfirmThreadCreateFloretCreated|ConfirmThreadCreateTitleSet|CommitThreadCreateSettings)\(' \
		internal 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Thread create checkpoints may only be advanced by the durable create coordinator."
	fi

  echo "[INFO] Floret canonical thread creation boundary checked"
}

check_removed_product_schema_paths() {
	local matches

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		'createThreadstoreSchemaV1|migrateProductV1ToV2|verifyProductV1Schema|createThreadForkOperationsTableV1' \
		internal/ai/threadstore 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "Product schema v1 migration code must not return; only existing v2 and current v3 are supported."
	fi

	if matches=$(rg -n --pcre2 --glob '*.go' --glob '!**/*_test.go' \
		--glob '!internal/ai/threadstore/schema.go' \
		'\bsubagent_id\b' internal 2>/dev/null); then
		printf '%s\n' "$matches"
		fail "The removed subagent_id alias may appear only in the explicit product-v2 schema contract used for v2 to v3 migration."
	fi

	echo "[INFO] removed product schema paths checked"
}

check_exact_run_capability_shapes() {
	if ! GOWORK=off go test ./internal/ai -run '^TestFloretRunCapabilityShapesAreExact$' -count=1; then
		fail "Per-run host and product capability fields must match the exact reviewed allowlists."
		return
	fi
	echo "[INFO] exact run capability shapes checked"
}

check_no_go_workspace_files
check_go_module_boundary
check_local_source_wiring
check_no_floret_internal_imports
check_no_floret_schema_access
check_no_agent_shadow_storage
check_floret_capability_bootstrap_boundary
check_floret_thread_creation_boundary
check_removed_product_schema_paths
check_exact_run_capability_shapes

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] Floret dependency boundary check passed"
