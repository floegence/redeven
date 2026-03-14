#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  ./scripts/open_source_hygiene_check.sh --all
  ./scripts/open_source_hygiene_check.sh --staged
USAGE
}

mode="${1:-}"
case "$mode" in
  --all|--staged)
    ;;
  *)
    usage
    exit 1
    ;;
esac

if ! command -v rg >/dev/null 2>&1; then
  echo "[ERROR] rg is required but not found in PATH." >&2
  exit 1
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[ERROR] gitleaks is required but not found in PATH." >&2
  echo "[ERROR] Install gitleaks before running this check." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

selected_files="$(mktemp)"
existing_files="$(mktemp)"
trap 'rm -f "$selected_files" "$existing_files"' EXIT

if [ "$mode" = "--all" ]; then
  git ls-files -z >"$selected_files"
else
  git diff --cached --name-only --diff-filter=ACMR -z >"$selected_files"
fi

if [ ! -s "$selected_files" ]; then
  echo "[INFO] open-source hygiene check: no files to scan"
  exit 0
fi

while IFS= read -r -d '' file_path; do
  case "$file_path" in
    scripts/open_source_hygiene_check.sh|.githooks/pre-commit)
      continue
      ;;
  esac
  if [ -e "$file_path" ]; then
    printf '%s\0' "$file_path" >>"$existing_files"
  fi
done <"$selected_files"

failed=0

run_pattern_check() {
  local pattern="$1"
  local title="$2"
  if [ ! -s "$existing_files" ]; then
    return 0
  fi
  if xargs -0 rg -n --pcre2 "$pattern" <"$existing_files"; then
    echo "[ERROR] ${title}" >&2
    failed=1
  fi
}

# Rule 1: block browser storage writes for token-like secret fields.
run_pattern_check "(?i)(sessionStorage|localStorage)\\.setItem\\([^\\n]*(token|secret|ticket|api[_-]?key)" \
  "Token-like secrets must not be persisted via sessionStorage/localStorage."

# Rule 2: block production domain literals.
run_pattern_check "(?i)\\b(redeven\\.com|version\\.agent\\.redeven\\.com|agent\\.package\\.redeven\\.com)\\b" \
  "Production domain literals are not allowed in this public repository."

# Rule 3: block internal delivery pipeline vocabulary from the public repo.
run_pattern_check "(?i)\\b(release hook|release hook|package mirror|delivery branch|version endpoint|installer wrapper)\\b|REDEVEN_[A-Z_]*(DISPATCH|TARGET)_[A-Z_]*" \
  "Internal delivery pipeline details must not appear in this public repository."

# Rule 4: block private delivery assets from being tracked again.
while IFS= read -r -d '' file_path; do
  [ -e "$file_path" ] || continue
  case "$file_path" in
    deployment/private-delivery/workers/*|scripts/publish_delivery_branch.sh|scripts/sync_release_assets.sh)
      echo "[ERROR] Private delivery assets do not belong in this public repository: $file_path" >&2
      failed=1
      ;;
  esac
done <"$selected_files"

# Rule 5: secret scan must be clean.
if ! gitleaks detect --source . --no-git --redact --exit-code 1 --config .gitleaks.toml >/dev/null; then
  echo "[ERROR] gitleaks detected potential secrets." >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] open-source hygiene check passed (${mode})"
