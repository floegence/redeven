#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

usage() {
  cat <<'USAGE'
Usage: ./scripts/check_final_integration.sh --base <commit> --tip <commit>

Runs the complete local integration gate for one exact rebased commit. The
pre-push hook supplies the remote main commit as --base and the local main tip
as --tip.
USAGE
}

base=""
tip=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      base="$2"
      shift 2
      ;;
    --tip)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      tip="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

[ -n "$base" ] && [ -n "$tip" ] || { usage >&2; exit 2; }

cd "$ROOT_DIR"
base="$(git rev-parse --verify "${base}^{commit}")"
tip="$(git rev-parse --verify "${tip}^{commit}")"
head_oid="$(git rev-parse HEAD)"

if [ "$head_oid" != "$tip" ]; then
  echo "[ERROR] final integration gate tip does not match HEAD" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$base" "$tip"; then
  echo "[ERROR] final integration gate tip is not based on the supplied main commit" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "[ERROR] final integration gate requires a clean worktree" >&2
  exit 1
fi

run_step() {
  local title="$1"
  shift
  echo "[INFO] ${title}"
  "$@"
}

check_shell_syntax() {
  sh -n scripts/install.sh
  sh -n scripts/generate_release_notes.sh
  bash -n scripts/test_generate_release_notes.sh
  bash -n scripts/lint_ui.sh
  bash -n scripts/build_desktop_bundled_runtime.sh
  bash -n scripts/build_desktop_bundled_agent.sh
  bash -n scripts/check_desktop.sh
  bash -n scripts/check_docker_runtime_e2e.sh
  bash -n scripts/check_final_integration.sh
  bash -n scripts/check_gateway_protocol_contract.sh
  bash -n scripts/check_floret_dependency_boundary.sh
  bash -n scripts/check_redevplugin_dependency_boundary.sh
  bash -n scripts/check_redevplugin_release_artifacts.sh
  bash -n scripts/check_redevplugin_consumption_gate.sh
  bash -n scripts/check_desktop_redevplugin_package.sh
  bash -n scripts/link_redevplugin_runtime_static_pie.sh
  bash -n scripts/stage_redevplugin_release_artifacts.sh
  bash -n scripts/check_plugin_integration.sh
  node --check scripts/check_catalog_plugin_package_url.mjs
  bash -n scripts/check_runtime_compatibility_contract.sh
  bash -n scripts/check_flower_live_protocol.sh
  bash -n scripts/check_flower_ui.sh
  bash -n scripts/okf/check_content_quality.sh
  bash -n scripts/ui_package_common.sh
  bash -n scripts/open_source_hygiene_check.sh
  bash -n scripts/install_git_hooks.sh
  bash -n scripts/test_git_hooks.sh
  bash -n .githooks/pre-commit
  bash -n .githooks/pre-push
}

run_step "checking final rebased diff" git diff --check "${base}...${tip}"
run_step "checking shell syntax" check_shell_syntax
run_step "testing README localization contract" node --test scripts/check_readme_localizations.test.mjs
run_step "checking reviewed README localizations" node scripts/check_readme_localizations.mjs --require-reviewed
run_step "testing Git hook contracts" ./scripts/test_git_hooks.sh
run_step "testing Go packages serially without cache" env GOWORK=off go test -p 1 -count=1 ./...
run_step "linting Go packages" env GOWORK=off golangci-lint run ./...
run_step "linting UI packages" ./scripts/lint_ui.sh
run_step "testing release note generation" ./scripts/test_generate_release_notes.sh
run_step "checking Runtime compatibility source" ./scripts/check_runtime_compatibility_contract.sh --source-only
run_step "checking ReDevPlugin dependency boundary" ./scripts/check_redevplugin_dependency_boundary.sh --ci
run_step "testing controlled release archive extraction" ./scripts/safe_extract_tar.py --self-test
run_step "testing controlled Desktop runtime extraction" ./scripts/extract_desktop_runtime.py --self-test
run_step "checking release artifact collector syntax" node --check scripts/collect_release_artifacts.mjs
run_step "testing release artifact collector" node --test scripts/collect_release_artifacts.test.mjs
run_step "testing public installer runtime contract" node --test scripts/install_redevplugin_contract.test.mjs
run_step "testing ReDevPlugin release artifact verifier" ./scripts/check_redevplugin_release_artifacts.sh --self-test
run_step "testing ReDevPlugin consumption gate" ./scripts/check_redevplugin_consumption_gate.sh --self-test
run_step "testing ReDevPlugin artifact staging" ./scripts/stage_redevplugin_release_artifacts.sh --self-test
run_step "building embedded assets" ./scripts/build_assets.sh
run_step "checking ReDevPlugin integration" ./scripts/check_plugin_integration.sh --ci
run_step "checking Gateway protocol contract" ./scripts/check_gateway_protocol_contract.sh
run_step "checking Floret dependency boundary" ./scripts/check_floret_dependency_boundary.sh
run_step "checking Flower live protocol" ./scripts/check_flower_live_protocol.sh
run_step "checking Flower UI" ./scripts/check_flower_ui.sh
run_step "checking Desktop" ./scripts/check_desktop.sh --full
run_step "checking Docker Runtime E2E" ./scripts/check_docker_runtime_e2e.sh
run_step "checking open-source hygiene" ./scripts/open_source_hygiene_check.sh --all
run_step "checking OKF source integrity" ./scripts/okf/check_source_integrity.sh
run_step "checking OKF content quality" ./scripts/okf/check_content_quality.sh --strict
run_step "verifying OKF bundle" ./scripts/build_okf_bundle.sh --verify-only

if [ -n "$(git status --porcelain)" ]; then
  echo "[ERROR] final integration gate changed the worktree" >&2
  git status --short >&2
  exit 1
fi

echo "[INFO] final integration gate passed for ${tip} on base ${base}"
