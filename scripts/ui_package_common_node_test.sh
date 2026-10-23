#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/redeven-node-contract.XXXXXX")
TEST_ROOT=$(cd -- "$TEST_ROOT" && pwd -P)
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

ELECTRON_FIXTURE="$TEST_ROOT/electron workspace"
ELECTRON_PACKAGE="$ELECTRON_FIXTURE/node_modules/electron"
EXPECTED_BINARY="$ELECTRON_PACKAGE/dist/Electron.app/Contents/MacOS/Electron"
mkdir -p "$(dirname -- "$EXPECTED_BINARY")"
printf '%s\n' '{"devDependencies":{"electron":"0.0.0-fixture"}}' > "$ELECTRON_FIXTURE/package.json"
printf '%s\n' '{"name":"electron","version":"0.0.0-fixture"}' > "$ELECTRON_PACKAGE/package.json"
printf '%s\n' '#!/usr/bin/env bash' 'printf "v0.0.0-fixture\n"' > "$EXPECTED_BINARY"
chmod +x "$EXPECTED_BINARY"
cat > "$ELECTRON_PACKAGE/index.js" <<'JS'
if (process.env.FAKE_ELECTRON_DOWNLOAD !== 'cached') {
  console.log('Downloading Electron binary...');
  require('node:child_process').spawnSync(process.execPath, ['-e', 'console.log("Electron installer output")'], { stdio: 'inherit' });
}
if (process.env.FAKE_ELECTRON_DOWNLOAD === 'failure') throw new Error('Electron download failed');
module.exports = require('node:path').join(__dirname, 'dist/Electron.app/Contents/MacOS/Electron');
JS

for download_case in cached download; do
  output=$(FAKE_ELECTRON_DOWNLOAD="$download_case" bash -c \
    'source "$1"; ui_pkg_electron_binary "$2"' bash \
    "$ROOT_DIR/scripts/ui_package_common.sh" "$ELECTRON_FIXTURE" 2> "$TEST_ROOT/diagnostics")
  [ "$output" = "$EXPECTED_BINARY" ] || { echo 'Electron diagnostics contaminated its path' >&2; exit 1; }
  if [ "$download_case" = cached ]; then
    [ ! -s "$TEST_ROOT/diagnostics" ]
  else
    grep -Fxq 'Downloading Electron binary...' "$TEST_ROOT/diagnostics"
    grep -Fxq 'Electron installer output' "$TEST_ROOT/diagnostics"
  fi
done

if FAKE_ELECTRON_DOWNLOAD=failure bash -c \
  'source "$1"; ui_pkg_electron_binary "$2"' bash \
  "$ROOT_DIR/scripts/ui_package_common.sh" "$ELECTRON_FIXTURE" > "$TEST_ROOT/path" 2> "$TEST_ROOT/diagnostics"; then
  echo 'Electron download failure was ignored' >&2
  exit 1
fi
[ ! -s "$TEST_ROOT/path" ]
grep -Fq 'Electron download failed' "$TEST_ROOT/diagnostics"

output=$(FAKE_ELECTRON_DOWNLOAD=download "$ROOT_DIR/scripts/check_desktop_electron_test_runtime.sh" \
  "$ELECTRON_FIXTURE" 2> "$TEST_ROOT/diagnostics")
grep -Fxq 'Desktop Electron runtime preflight passed: v0.0.0-fixture' <<<"$output"
grep -Fxq 'Downloading Electron binary...' "$TEST_ROOT/diagnostics"
grep -Fxq 'Electron installer output' "$TEST_ROOT/diagnostics"

echo "shared UI Node contract tests passed"
