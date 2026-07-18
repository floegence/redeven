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

  if matches=$(rg -n --pcre2 --glob '!scripts/check_floret_dependency_boundary.sh' --glob '!internal/session/dependency_contract_test.go' 'active_turn_leases|schema_meta|raw_encoder_version' "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven must not reference Floret-owned storage schema tables or columns."
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
		--glob '!internal/ai/threadstore/canonical_migrations.go' \
    "$shadow_pattern" internal 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Redeven production code must not define, query, or persist Agent shadow conversation state."
  fi

  echo "[INFO] Agent shadow storage boundary checked"
}

check_no_go_workspace_files
check_go_module_boundary
check_local_source_wiring
check_no_floret_internal_imports
check_no_floret_schema_access
check_no_agent_shadow_storage

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] Floret dependency boundary check passed"
