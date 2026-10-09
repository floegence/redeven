#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
if [ "${FAKE_SESSION_CASE:-}" = "" ]; then
  for session_case in interrupt terminate normal gateway-failure gateway-interrupt; do
    FAKE_SESSION_CASE="$session_case" "$0"
  done
  exit 0
fi
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
FAKE_GATEWAY_STOPPED="$TEST_ROOT/gateway-stopped"
FAKE_GATEWAY_PREPARING="$TEST_ROOT/gateway-preparing"
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
cp "$ROOT_DIR/scripts/prune_dev_desktop_bundles.mjs" "$FAKE_SCRIPTS/"
cp "$ROOT_DIR/scripts/dev_desktop_gateways.mjs" "$FAKE_SCRIPTS/"
cp "$ROOT_DIR/.node-version" "$FAKE_CHECKOUT/.node-version"
printf '%s\n' '{"name":"@floegence/redeven-desktop"}' > "$FAKE_DESKTOP/package.json"
printf '%s\n' 'module.exports = process.env.FAKE_ELECTRON_PATH;' > "$FAKE_DESKTOP/node_modules/electron/index.js"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'rm -f "$FAKE_RUNTIME_STOPPED"' \
  'printf "%s\\n" "$$" > "$FAKE_ELECTRON_STARTED"' \
  'on_signal() {' \
  '  printf "%s\\n" "$$" > "$FAKE_ELECTRON_STOPPED"' \
  '  exit 0' \
  '}' \
  'trap on_signal INT TERM' \
  'if [ "$FAKE_SESSION_CASE" = normal ]; then sleep 0.2; exit 0; fi' \
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

export FAKE_ELECTRON_PATH FAKE_ELECTRON_STARTED FAKE_ELECTRON_STOPPED FAKE_RUNTIME_STOPPED FAKE_GATEWAY_STOPPED FAKE_GATEWAY_PREPARING FAKE_SESSION_CASE
mkdir -p "$FAKE_DESKTOP/dist/main" "$STATE_ROOT/local-environment/gateway"
cat > "$FAKE_DESKTOP/dist/main/gatewayServiceHost.js" <<'JS'
const fs = require('node:fs/promises');
const path = require('node:path');
exports.ensureManagedGatewayServiceReady = async options => {
  if (!options.forceUpdate || options.targetCommit !== 'signal-test') throw new Error('Gateway was not refreshed from current source');
  const binary = path.join(options.stateRoot, 'managed/bin/redeven-gateway');
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(binary, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.FAKE_GATEWAY_STOPPED, process.argv.slice(2).join(" "));\n', { mode: 0o700 });
  if (process.env.FAKE_SESSION_CASE === 'gateway-failure') throw new Error('Gateway startup failed');
  if (process.env.FAKE_SESSION_CASE === 'gateway-interrupt') {
    await fs.writeFile(process.env.FAKE_GATEWAY_PREPARING, 'ready');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Preparation canceled')); }, { once: true });
    });
  }
};
JS
printf '%s\n' 'exports.DefaultDesktopSSHTransportManager = class { async dispose() {} };' > "$FAKE_DESKTOP/dist/main/sshTransportManager.js"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ schema_version: 4, gateways: [{ gateway_id: "fixture", local_enabled: true, connection: { kind: "local_host", runtime_root: process.argv[2] } }] }))' \
  "$STATE_ROOT/local-environment/gateway/gateways.json" "$STATE_ROOT"
node --input-type=module - "$STATE_ROOT" <<'JS'
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
for (let i = 0; i < 6; i++) {
  const manifest = JSON.stringify({ schema_version: 1, old_bundle: i });
  const path = join(process.argv[2], 'desktop/bundles', createHash('sha256').update(manifest).digest('hex'));
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'desktop-bundle-manifest.json'), manifest);
  chmodSync(path, 0o500);
  utimesSync(path, i + 1, i + 1);
}
JS
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
  if [ "$FAKE_SESSION_CASE" = gateway-failure ]; then
    [ -f "$FAKE_GATEWAY_STOPPED" ] && break
  elif [ "$FAKE_SESSION_CASE" = gateway-interrupt ]; then
    [ -f "$FAKE_GATEWAY_PREPARING" ] && break
  else
    [ -f "$FAKE_ELECTRON_STARTED" ] && break
  fi
  sleep 0.05
done
if [ "$FAKE_SESSION_CASE" != gateway-failure ] && [ "$FAKE_SESSION_CASE" != gateway-interrupt ] && [ ! -f "$FAKE_ELECTRON_STARTED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'dev Desktop did not reach the Electron process\n' >&2
  exit 1
fi

bundle_count=$(node -e 'process.stdout.write(String(require("node:fs").readdirSync(process.argv[1]).filter(name => /^[a-f0-9]{64}$/.test(name)).length))' "$STATE_ROOT/desktop/bundles")
if [ "$bundle_count" -ne 3 ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'expected launch to retain three development bundles, got %s\n' "$bundle_count" >&2
  exit 1
fi

case "$FAKE_SESSION_CASE" in
  interrupt) kill -INT "$SESSION_PID" ;;
  gateway-interrupt) kill -INT "$SESSION_PID" ;;
  terminate) kill -TERM "$SESSION_PID" ;;
esac
wait "$SESSION_PID" >/dev/null 2>&1 || true
SESSION_PID=""

for _ in $(seq 1 100); do
  [ -f "$FAKE_GATEWAY_STOPPED" ] && [ -f "$FAKE_RUNTIME_STOPPED" ] && break
  sleep 0.05
done
if { [ "$FAKE_SESSION_CASE" = interrupt ] || [ "$FAKE_SESSION_CASE" = terminate ]; } && [ ! -f "$FAKE_ELECTRON_STOPPED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'Ctrl+C did not stop the Desktop process\n' >&2
  exit 1
fi
if [ ! -f "$FAKE_GATEWAY_STOPPED" ] || ! rg -Fq -- "service-stop --state-root $STATE_ROOT/gateways/fixture/state" "$FAKE_GATEWAY_STOPPED"; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'Session exit did not stop the exact development Gateway\n' >&2
  exit 1
fi
if { [ "$FAKE_SESSION_CASE" = gateway-failure ] || [ "$FAKE_SESSION_CASE" = gateway-interrupt ]; } && [ -f "$FAKE_ELECTRON_STARTED" ]; then
  printf 'Desktop started despite Gateway preparation failure\n' >&2
  exit 1
fi
if [ "$FAKE_SESSION_CASE" = normal ]; then
  rm "$FAKE_RUNTIME_STOPPED" "$FAKE_GATEWAY_STOPPED"
  "$FAKE_SCRIPTS/dev_desktop.sh" --stop-only > "$TEST_ROOT/stop-only.log" 2>&1
  if [ ! -f "$FAKE_RUNTIME_STOPPED" ] || [ ! -f "$FAKE_GATEWAY_STOPPED" ]; then
    cat "$TEST_ROOT/stop-only.log" >&2
    printf 'Stop-only did not use the saved bundle and Gateway connection\n' >&2
    exit 1
  fi
fi
if [ ! -f "$FAKE_RUNTIME_STOPPED" ]; then
  cat "$TEST_ROOT/session.log" >&2
  printf 'Development session exit did not stop the current local Runtime\n' >&2
  exit 1
fi
if ! rg -Fq -- "--runtime-root $STATE_ROOT/local-environment" "$FAKE_RUNTIME_STOPPED" \
  || ! rg -Fq -- "--state-root $STATE_ROOT" "$FAKE_RUNTIME_STOPPED" \
  || rg -Fq -- "--state-root $STATE_ROOT/local-environment" "$FAKE_RUNTIME_STOPPED"; then
  cat "$FAKE_RUNTIME_STOPPED" >&2
  printf 'Ctrl+C did not use the Local Runtime root with the outer Desktop state root\n' >&2
  exit 1
fi

printf 'dev Desktop cleanup test passed: %s\n' "$FAKE_SESSION_CASE"
