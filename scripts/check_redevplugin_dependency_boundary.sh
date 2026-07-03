#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  ./scripts/check_redevplugin_dependency_boundary.sh [--ci]

Checks that Redeven consumes ReDevPlugin only through released artifacts and
does not grow a local copy of the plugin-platform core.
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

  if matches=$(rg -n --pcre2 'github\.com/floegence/redevplugin[^\n]*=>[[:space:]]*(\.{1,2}/|/|file:|[A-Za-z]:)' go.mod go.sum 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "ReDevPlugin must not be wired through a local Go replace target."
  fi

  if matches=$(rg -n --pcre2 '^\s*replace\s+github\.com/floegence/redevplugin\b' go.mod 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "ReDevPlugin Go module replacements are forbidden in Redeven."
  fi

  if rg -q --pcre2 '"github\.com/floegence/redevplugin(/[^"]*)?"' --glob '*.go' .; then
    if ! rg -q --pcre2 '^\s*github\.com/floegence/redevplugin\s+v[0-9]+\.[0-9]+\.[0-9]+' go.mod; then
      fail "Go source imports ReDevPlugin but go.mod does not require a published semver module."
    fi
  fi

  echo "[INFO] Go module boundary checked"
}

check_package_boundary() {
  local package_files=()
  local matches

  while IFS= read -r -d '' package_file; do
    package_files+=("$package_file")
  done < <(
    find "$ROOT_DIR" -type f \( \
      -name package.json -o \
      -name package-lock.json -o \
      -name pnpm-lock.yaml -o \
      -name pnpm-workspace.yaml -o \
      -name yarn.lock \
    \) -print0
  )

  if [ "${#package_files[@]}" -eq 0 ]; then
    echo "[INFO] no package manager files found"
    return
  fi

  if matches=$(rg -n --pcre2 '(?i)redevplugin[^\n]*(file:|link:|workspace:|portal:|\.{1,2}/|/Users/|/tmp/|[A-Za-z]:\\)' "${package_files[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "ReDevPlugin npm packages must not use local package-manager wiring."
  fi

  echo "[INFO] package-manager boundary checked"
}

check_local_source_wiring() {
  local matches
  local scan_paths=()

  for candidate in .github scripts cmd internal desktop go.mod; do
    if [ -e "$candidate" ]; then
      scan_paths+=("$candidate")
    fi
  done

  if [ "${#scan_paths[@]}" -gt 0 ] && matches=$(rg -n --pcre2 --glob '!scripts/check_redevplugin_dependency_boundary.sh' --glob '!scripts/check_redevplugin_release_artifacts.sh' --glob '!scripts/check_redevplugin_consumption_gate.sh' '(?i)(\.\./redevplugin|/redevplugin\b|file:[^\n]*redevplugin|link:[^\n]*redevplugin|workspace:[^\n]*redevplugin|portal:[^\n]*redevplugin)' "${scan_paths[@]}" 2>/dev/null); then
    printf '%s\n' "$matches"
    fail "Build, script, and source files must not point at a local ReDevPlugin checkout."
  fi

  echo "[INFO] local source wiring checked"
}

check_no_platform_core_copy() {
  local path
  local forbidden_paths=(
    "internal/plugins"
    "internal/plugins/runtime"
    "internal/plugins/registry"
    "internal/plugins/bridge"
    "internal/plugins/storage"
    "internal/plugins/network"
    "spec/plugin"
    "spec/openapi/plugin-platform-v1.yaml"
  )

  for path in "${forbidden_paths[@]}"; do
    if [ -e "$path" ]; then
      fail "ReDevPlugin platform core or generated contract copy is forbidden in Redeven: $path"
    fi
  done

  while IFS= read -r -d '' plugin_core_dir; do
    fail "Redeven must not create internal/plugins* platform-core directories: ${plugin_core_dir#./}"
  done < <(find ./internal -maxdepth 1 -type d -name 'plugins*' -print0 2>/dev/null)

  echo "[INFO] platform-core copy boundary checked"
}

check_no_go_workspace_files
check_go_module_boundary
check_package_boundary
check_local_source_wiring
check_no_platform_core_copy

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] ReDevPlugin dependency boundary check passed"
