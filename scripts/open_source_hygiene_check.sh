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
trap 'rm -f "$selected_files"' EXIT

if [ "$mode" = "--all" ]; then
  git ls-files -z >"$selected_files"
else
  git diff --cached --name-only --diff-filter=ACMR -z >"$selected_files"
fi

if [ ! -s "$selected_files" ]; then
  echo "[INFO] open-source hygiene check: no files to scan"
  exit 0
fi

failed=0

run_pattern_check() {
  local pattern="$1"
  local title="$2"
  if xargs -0 rg -n --pcre2 \
    --glob '!scripts/open_source_hygiene_check.sh' \
    --glob '!.githooks/pre-commit' \
    "$pattern" <"$selected_files"; then
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

# Rule 3: block external delivery route/zone values unless they are example.invalid placeholders.
while IFS= read -r -d '' file_path; do
  case "$file_path" in
    *wrangler.toml)
      if rg -n --pcre2 '^\s*pattern\s*=\s*"(?![^"]*example\.invalid)[^"]+"' "$file_path"; then
        echo "[ERROR] external delivery route pattern must use example.invalid placeholders: $file_path" >&2
        failed=1
      fi
      if rg -n --pcre2 '^\s*zone_(name|id)\s*=\s*"(?!example\.invalid")[^"]+"' "$file_path"; then
        echo "[ERROR] external delivery zone bindings must use example.invalid placeholders: $file_path" >&2
        failed=1
      fi
      ;;
  esac
done <"$selected_files"

# Rule 4: secret scan must be clean.
if ! gitleaks detect --source . --no-git --redact --exit-code 1 --config .gitleaks.toml >/dev/null; then
  echo "[ERROR] gitleaks detected potential secrets." >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] open-source hygiene check passed (${mode})"
