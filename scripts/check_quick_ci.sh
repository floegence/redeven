#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
cd "$ROOT_DIR"

echo "[INFO] checking repository diff and Go formatting"
git diff --check
git diff-tree --check --root -r --no-commit-id HEAD
test -z "$(gofmt -l $(git ls-files '*.go'))"

echo "[INFO] checking shell, JavaScript, and Python syntax"
for script in scripts/*.sh scripts/okf/*.sh .githooks/pre-commit .githooks/pre-push; do
  bash -n "$script"
done
for script in scripts/*.mjs; do
  node --check "$script"
done
python3 -c 'from pathlib import Path; [compile(Path(name).read_text(encoding="utf-8"), name, "exec") for name in ("scripts/safe_extract_tar.py", "scripts/extract_desktop_runtime.py")]'

echo "[INFO] checking bounded cloud policy and committed knowledge artifacts"
node --test scripts/quick_ci_policy.test.mjs scripts/actionlint_runner_policy.test.mjs scripts/check_go_version_consistency.test.mjs
node scripts/check_go_version_consistency.mjs
node --test scripts/check_readme_localizations.test.mjs
node scripts/check_readme_localizations.mjs
./scripts/okf/check_source_integrity.sh
./scripts/build_okf_bundle.sh --verify-only

echo "[INFO] quick CI passed"
