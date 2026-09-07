#!/usr/bin/env bash
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: integrate_service_template_update.sh <base> <private-branch>" >&2; exit 2; }
base="$(git rev-parse --verify "${1}^{commit}")"
branch="$2"
[[ "$branch" == codex/* ]] || { echo "a private codex branch is required" >&2; exit 1; }
test "$(git symbolic-ref HEAD)" = refs/heads/main
test "$(git rev-parse main)" = "$base"
test -z "$(git status --porcelain)"
git merge-base --is-ancestor "$base" "$branch"
git fetch origin main
test "$(git rev-parse origin/main)" = "$base"
git merge --ff-only "$branch"
bash scripts/install_git_hooks.sh
# The pre-push hook owns the only full gate, on this exact checked-out main tip.
git push origin main
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
