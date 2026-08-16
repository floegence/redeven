#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/redeven-node-contract.XXXXXX")
cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == "-p" ]]; then' \
  '  printf "%s\\n" "${FAKE_NODE_VERSION:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "--version" ]]; then' \
  '  printf "v%s\\n" "${FAKE_NODE_VERSION:?}"' \
  '  exit 0' \
  'fi' \
  'exit 2' >"$TEST_ROOT/bin/node"
chmod +x "$TEST_ROOT/bin/node"

run_check() {
  FAKE_NODE_VERSION="$1" PATH="$TEST_ROOT/bin:$PATH" bash -c \
    'source "$1"; ui_pkg_require_node_26 "$2"' bash "$ROOT_DIR/scripts/ui_package_common.sh" "$ROOT_DIR"
}

run_check 26.7.0
for rejected_version in 24.14.1 27.0.0; do
  if output=$(run_check "$rejected_version" 2>&1); then
    echo "shared UI helper accepted Node $rejected_version" >&2
    exit 1
  fi
  grep -q "Node.js 26.x is required; found v$rejected_version" <<<"$output"
done

echo "shared UI Node contract tests passed"
