#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks
echo "[INFO] git hooks enabled via .githooks/"
echo "[INFO] pre-commit runs fast staged checks; pushes to main run the final integration gate"
