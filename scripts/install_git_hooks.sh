#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git config core.hooksPath .githooks
echo "[INFO] git hooks enabled via .githooks/"
echo "[INFO] pre-commit now runs README localization, hygiene, ReDevPlugin readiness, full Desktop, and Docker runtime E2E checks"
