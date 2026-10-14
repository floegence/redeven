#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks
for hook in .githooks/*; do
  if [[ -f "$hook" ]]; then chmod +x "$hook"; fi
done
echo "[INFO] git hooks enabled via .githooks/"
echo "[INFO] staged checks and exact-main groups reuse only matching local tree/environment passes"
