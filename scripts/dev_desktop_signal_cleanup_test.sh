#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/redeven-desktop-signal.XXXXXX")
TEST_ROOT=$(cd "$TEST_ROOT" && pwd -P)
FAKE_CHECKOUT="$TEST_ROOT/redeven-signal-fixture"
FAKE_DESKTOP="$FAKE_CHECKOUT/desktop"
FAKE_SCRIPTS="$FAKE_CHECKOUT/scripts"
FAKE_BIN="$TEST_ROOT/bin"
TEST_HOME="$TEST_ROOT/home"
STATE_ROOT="$TEST_ROOT/state"
FAKE_ELECTRON_STARTED="$TEST_ROOT/electron-started"
FAKE_ELECTRON_STOPPED="$TEST_ROOT/electron-stopped"
FAKE_RUNTIME_STOPPED="$TEST_ROOT/runtime-stopped"
FAKE_ELECTRON_PATH="$TEST_ROOT/fake-electron"
SESSION_PID=""

cleanup() {
  if [ -n "$SESSION_PID" ] && kill -0 "$SESSION_PID" >/dev/null 2>&1; then
    kill -TERM "$SESSION_PID" >/dev/null 2>&1 || true
    wait "$SESSION_PID" >/dev/null 2>&1 || true
  fi
  chmod -R u+w "$TEST_ROOT" 2>/dev/null || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_DESKTOP/node_modules/electron" "$FAKE_SCRIPTS" "$FAKE_BIN" "$TEST_HOME"
cp "$ROOT_DIR/scripts/dev_desktop.sh" "$ROOT_DIR/scripts/ui_package_common.sh" "$FAKE_SCRIPTS/"
cp "$ROOT_DIR/.node-version" "$FAKE_CHECKOUT/.node-version"
printf '%s\n' '{"name":"@floegence/redeven-desktop"}' > "$FAKE_DESKTOP/package.json"
printf '%s\n' 'module.exports = process.env.FAKE_ELECTRON_PATH;' > "$FAKE_DESKTOP/node_modules/electron/index.js"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\\n" "$$" > "$FAKE_ELECTRON_STARTED"' \
  'on_signal() {' \
  '  printf "%s\\n" "$$" > "$FAKE_ELECTRON_STOPPED"' \
  '  exit 0' \
  '}' \
  'trap on_signal INT TERM' \
  'while :; do sleep 0.05; done' > "$FAKE_ELECTRON_PATH"
chmod 700 "$FAKE_ELECTRON_PATH"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'case "${1:-}:${2:-}" in' \
  '  run:build)' \
  '    exit 0' \
  '    ;;' \
  '  run:prepare:bundled-runtime)' \
  '    mkdir -p "$REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR"' \
  '    printf "%s\\n" "{\\"schema_version\\":1}" > "$REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR/desktop-bundle-manifest.json"' \
  '    printf "%s\\n" "#!/usr/bin/env bash" "if [ \"\${1:-}\" = desktop-runtime-stop ]; then printf \"%s %s\\n\" \"\$1\" \"\$*\" >> \"\$FAKE_RUNTIME_STOPPED\"; fi" > "$REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR/redeven"' \
  '    chmod 700 "$REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR/redeven"' \
  '    ;;' \
  'esac' > "$FAKE_BIN/npm"
chmod 700 "$FAKE_BIN/npm"

export FAKE_ELECTRON_PATH FAKE_ELECTRON_STARTED FAKE_ELECTRON_STOPPED FAKE_RUNTIME_STOPPED
export PATH="$FAKE_BIN:$PATH"
export HOME="$TEST_HOME"
export REDEVEN_STATE_ROOT="$STATE_ROOT"
export REDEVEN_DESKTOP_BUNDLE_COMMIT="signal-test"
export REDEVEN_DESKTOP_LOCAL_UI_BIND="localhost:32140"
export REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT=0
export REDEVEN_DESKTOP_INSPECT_PORT=0

mkdir -p "$STATE_ROOT/local-environment"
printf '%s\n' 'legacy-runtime-lock' > "$STATE_ROOT/local-environment/agent.lock"

SESSION_PID="$(node -e '
  const { spawn } = require("node:child_process");
  const fs = require("node:fs");
  const log = fs.openSync(process.argv[2], "w");
  const child = spawn(process.argv[1], process.argv.slice(3), {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  process.stdout.write(String(child.pid));
' "$FAKE_SCRIPTS/dev_desktop.sh" "$TEST_ROOT/session.log" --no-devtools)"
for _ in $(seq 1 100); do
  [ -f "$FAKE_ELECTRON_STARTED" ] && break
  sleep 0.05
done
if [ ! -f "$FAKE_ELECTRON_STARTED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'dev Desktop did not reach the Electron process\n' >&2
  exit 1
fi

kill -INT "$SESSION_PID"
wait "$SESSION_PID" >/dev/null 2>&1 || true
SESSION_PID=""

for _ in $(seq 1 100); do
  [ -f "$FAKE_ELECTRON_STOPPED" ] && [ -f "$FAKE_RUNTIME_STOPPED" ] && break
  sleep 0.05
done
if [ ! -f "$FAKE_ELECTRON_STOPPED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'Ctrl+C did not stop the Desktop process\n' >&2
  exit 1
fi
if [ ! -f "$FAKE_RUNTIME_STOPPED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'Ctrl+C did not stop the current local Runtime\n' >&2
  exit 1
fi
if ! rg -Fq -- "--state-root $STATE_ROOT/local-environment" "$FAKE_RUNTIME_STOPPED" \
  || ! rg -Fq -- "--state-root $STATE_ROOT" "$FAKE_RUNTIME_STOPPED"; then
  cat "$FAKE_RUNTIME_STOPPED" >&2
  printf 'Ctrl+C did not cover current and legacy local Runtime state roots\n' >&2
  exit 1
fi

printf 'dev Desktop signal cleanup test passed\n'
