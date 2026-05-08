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
domain_matches="$(mktemp)"
trap 'rm -f "$selected_files" "$existing_files" "$domain_matches"' EXIT

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
    scripts/open_source_hygiene_check.sh|scripts/test_open_source_hygiene_check.sh|.githooks/pre-commit)
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

check_public_domain_literals() {
  if [ ! -s "$existing_files" ]; then
    return 0
  fi

  : >"$domain_matches"
  if ! xargs -0 rg -n --pcre2 "(?i)\\b(redeven\\.com|version\\.agent\\.redeven\\.com|agent\\.package\\.redeven\\.com)\\b" <"$existing_files" >"$domain_matches"; then
    if [ ! -s "$domain_matches" ]; then
      return 0
    fi
  fi

  local domain_failed=0
  while IFS=: read -r file_path line_number line_text; do
    local cleaned_line="$line_text"
    cleaned_line="${cleaned_line//https:\/\/redeven.com\/install.sh/}"
    cleaned_line="${cleaned_line//https:\/\/version.agent.redeven.com\/v1\/manifest.json/}"
    if printf '%s\n' "$cleaned_line" | rg -q --pcre2 "(?i)\\b(redeven\\.com|version\\.agent\\.redeven\\.com|agent\\.package\\.redeven\\.com)\\b"; then
      printf '%s:%s:%s\n' "$file_path" "$line_number" "$line_text"
      domain_failed=1
    fi
  done <"$domain_matches"

  if [ "$domain_failed" -ne 0 ]; then
    echo "[ERROR] Only the public runtime endpoint literals https://redeven.com/install.sh and https://version.agent.redeven.com/v1/manifest.json may appear in this public repository." >&2
    failed=1
  fi
}

# Rule 1: block browser storage writes for token-like secret fields.
run_pattern_check "(?i)(sessionStorage|localStorage)\\.setItem\\([^\\n]*(token|secret|ticket|api[_-]?key)" \
  "Token-like secrets must not be persisted via sessionStorage/localStorage."

# Rule 2: only the public runtime endpoint literals may appear.
check_public_domain_literals

# Rule 3: block internal delivery pipeline vocabulary from the public repo.
run_pattern_check "(?i)\\b(release hook|package mirror|delivery branch|version endpoint|installer wrapper)\\b|REDEVEN_[A-Z_]*(DISPATCH|TARGET)_[A-Z_]*" \
  "Internal delivery pipeline details must not appear in this public repository."

# Rule 4: block private control-plane product naming without banning technical portal terminology.
run_pattern_check "(?i)(^|[^[:alnum:]])(redeven[-_ ]portal|portal session|region portal|portal console)([^[:alnum:]]|$)" \
  "Private control-plane product naming must not appear in this public repository."
run_pattern_check "\\b[A-Za-z0-9_]*Portal[A-Z][A-Za-z0-9_]*\\b|\\bportal(Origin|BaseDomain|First)\\b|case ['\\\"]portal['\\\"]" \
  "Private control-plane product naming must not appear in this public repository."

# Rule 5: block private delivery assets from being tracked again.
while IFS= read -r -d '' file_path; do
  [ -e "$file_path" ] || continue
  case "$file_path" in
    deployment/*/workers/*|scripts/*release*branch*.sh|scripts/*sync*to*r2*.sh)
      echo "[ERROR] Private delivery assets do not belong in this public repository: $file_path" >&2
      failed=1
      ;;
  esac
done <"$selected_files"

# Rule 6: secret scan must be clean.
if ! gitleaks detect --source . --no-git --redact --exit-code 1 --config .gitleaks.toml >/dev/null; then
  echo "[ERROR] gitleaks detected potential secrets." >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "[INFO] open-source hygiene check passed (${mode})"
