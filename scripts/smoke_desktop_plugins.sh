#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
source "$ROOT_DIR/scripts/ui_package_common.sh"
ui_pkg_require_node_26 "$ROOT_DIR"
MODE=isolated
if [[ "${1:-}" == "--attach" ]]; then
  MODE=attach
  shift
fi
[[ $# -eq 0 ]] || { echo "usage: $0 [--attach]" >&2; exit 2; }
SMOKE_ROOT=${REDEVEN_PLUGIN_SMOKE_ROOT:-$(mktemp -d "/tmp/redeven-plugin-smoke.XXXXXX")}
SEED_ROOT=${REDEVEN_PLUGIN_SMOKE_SEED_ROOT:-}
REUSE_SEED_STATE=${REDEVEN_PLUGIN_SMOKE_REUSE_SEED_STATE:-0}
STATE_ROOT="$SMOKE_ROOT/state"
USER_DATA_ROOT="$SMOKE_ROOT/user-data"
CACHE_ROOT="$SMOKE_ROOT/cache"
TEMP_ROOT="$SMOKE_ROOT/temp"
REPORT_ROOT="$SMOKE_ROOT/report"
PID_FILE="$REPORT_ROOT/pids.txt"
DESKTOP_LOG="$REPORT_ROOT/desktop.log"
LAUNCH_PID=
PIDS_RELEASED=true
LINUX_CONTAINER_ID=
LINUX_TARGET_ROOT="$SMOKE_ROOT/linux-target"
LINUX_UI_PORT=
LINUX_INTERNAL_UI_PORT=
LINUX_REDEVEN_EXEC_PID=
LINUX_RUNTIME_PID=
LINUX_SERVER_PID=
LINUX_PIDS_RELEASED=true
FIXTURE_HTTP_PORT=
FIXTURE_TCP_PORT=
FIXTURE_UDP_PORT=
FIXTURE_PORTS_JSON=
LINUX_REPORT="$REPORT_ROOT/linux-target.json"

reserve_port() {
  node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

reserve_linux_ports() {
  local LOW_PORT_MIN=20000 LOW_PORT_MAX=29999
  node - "$LOW_PORT_MIN" "$LOW_PORT_MAX" <<'NODE'
const net = require('node:net');
const dgram = require('node:dgram');
const [minimum, maximum] = process.argv.slice(2).map(Number);
const ports = [];
const sockets = [];
const candidate = () => minimum + Math.floor(Math.random() * (maximum - minimum + 1));
const reserveTCP = (port) => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { sockets.push(server); resolve(); });
});
const reserveUDP = (port) => new Promise((resolve, reject) => {
  const socket = dgram.createSocket('udp4');
  socket.once('error', reject);
  socket.bind(port, '127.0.0.1', () => { sockets.push(socket); resolve(); });
});
(async () => {
  while (ports.length < 5) {
    const port = candidate();
    if (ports.includes(port)) continue;
    try {
      if (ports.length < 4) await reserveTCP(port);
      else await reserveUDP(port);
      ports.push(port);
    } catch {}
  }
  if (new Set(ports).size === ports.length) process.stdout.write(`${ports.join(' ')}\n`);
  for (const socket of sockets) await new Promise((resolve) => socket.close(resolve));
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
}

if [[ "$MODE" == "attach" ]]; then
  LOCAL_UI_PORT=${REDEVEN_PLUGIN_SMOKE_LOCAL_UI_PORT:-23998}
  CDP_PORT=${REDEVEN_PLUGIN_SMOKE_CDP_PORT:-9222}
  INSPECTOR_PORT=${REDEVEN_PLUGIN_SMOKE_INSPECTOR_PORT:-9230}
else
  LOCAL_UI_PORT=${REDEVEN_PLUGIN_SMOKE_LOCAL_UI_PORT:-$(reserve_port)}
  CDP_PORT=${REDEVEN_PLUGIN_SMOKE_CDP_PORT:-$(reserve_port)}
  INSPECTOR_PORT=${REDEVEN_PLUGIN_SMOKE_INSPECTOR_PORT:-$(reserve_port)}
fi

prepare_linux_target() {
  command -v docker >/dev/null 2>&1 || { echo "Linux smoke requires docker" >&2; return 1; }
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || { echo "Linux smoke requires a Docker daemon" >&2; return 1; }
  local docker_arch
  docker_arch=$(docker info --format '{{.Architecture}}')
  [[ "$docker_arch" == "aarch64" || "$docker_arch" == "arm64" ]] || { echo "Linux smoke requires the task-owned linux/arm64 Docker target (got $docker_arch)" >&2; return 1; }
  mkdir -p "$LINUX_TARGET_ROOT"
  local default_linux_ui_port default_linux_internal_ui_port default_fixture_http_port default_fixture_tcp_port default_fixture_udp_port
  read -r default_linux_ui_port default_linux_internal_ui_port default_fixture_http_port default_fixture_tcp_port default_fixture_udp_port < <(reserve_linux_ports)
  LINUX_UI_PORT=${REDEVEN_PLUGIN_SMOKE_LINUX_UI_PORT:-$default_linux_ui_port}
  LINUX_INTERNAL_UI_PORT=${REDEVEN_PLUGIN_SMOKE_LINUX_INTERNAL_UI_PORT:-$default_linux_internal_ui_port}
  FIXTURE_HTTP_PORT=${REDEVEN_PLUGIN_SMOKE_FIXTURE_HTTP_PORT:-$default_fixture_http_port}
  FIXTURE_TCP_PORT=${REDEVEN_PLUGIN_SMOKE_FIXTURE_TCP_PORT:-$default_fixture_tcp_port}
  FIXTURE_UDP_PORT=${REDEVEN_PLUGIN_SMOKE_FIXTURE_UDP_PORT:-$default_fixture_udp_port}
  local image="debian:bookworm-slim" runtime_tag runtime_version runtime_cache published_module_dir
  runtime_tag=$(cd "$ROOT_DIR" && GOWORK=off go list -m -f '{{.Version}}' github.com/floegence/redevplugin/v3)
  [[ "$runtime_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "invalid ReDevPlugin module version: $runtime_tag" >&2; return 1; }
  runtime_version=${runtime_tag#v}
  published_module_dir=$(cd "$ROOT_DIR" && GOWORK=off go list -m -f '{{.Dir}}' "github.com/floegence/redevplugin/v3@${runtime_tag}")
  runtime_cache="${XDG_CACHE_HOME:-$HOME/.cache}/redeven/docker-runtime-e2e/redevplugin-runtime-${runtime_version}-rust-1.88.0-linux-arm64-$(git -C "$ROOT_DIR" rev-parse HEAD)-evidence-v1"
  if [[ ! -x "$runtime_cache/redevplugin-runtime" || ! -f "$runtime_cache/.redevplugin-release-artifacts-verified.json" ]]; then
    "$ROOT_DIR/scripts/check_docker_runtime_e2e.sh" >/dev/null
  fi
  [[ -x "$runtime_cache/redevplugin-runtime" && -f "$runtime_cache/.redevplugin-release-artifacts-verified.json" ]] || { echo "published Linux runtime evidence was not produced" >&2; return 1; }
  "$ROOT_DIR/scripts/build_assets.sh" >/dev/null
  docker run --rm --platform linux/arm64 -v "$ROOT_DIR:/src" -v "$LINUX_TARGET_ROOT:/out" -w /src golang:1.26.6-bookworm bash -ceu 'CGO_ENABLED=0 GOWORK=off go build -trimpath -o /out/redeven ./cmd/redeven; CGO_ENABLED=0 GOWORK=off go build -trimpath -o /out/io-server ./scripts/fixtures/redevplugin_io_smoke_server'
  REDEVPLUGIN_IO_SMOKE_HTTP_PORT="$FIXTURE_HTTP_PORT" \
  REDEVPLUGIN_IO_SMOKE_WS_PORT="$FIXTURE_HTTP_PORT" \
  REDEVPLUGIN_IO_SMOKE_TCP_PORT="$FIXTURE_TCP_PORT" \
  REDEVPLUGIN_IO_SMOKE_UDP_PORT="$FIXTURE_UDP_PORT" \
    pnpm --dir "$ROOT_DIR/internal/envapp/ui_src" exec vite build --config "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke/vite.config.mjs" >/dev/null
  cp "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke/ui/index.html" "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke/dist/ui/index.html"
  docker run --rm --platform linux/arm64 -v "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke:/src" -v "$LINUX_TARGET_ROOT:/out" -w /src/worker rust:1.88.0-bookworm bash -ceu 'rustup target add wasm32-unknown-unknown >/dev/null; cargo build --release --target wasm32-unknown-unknown; install -m 0644 target/wasm32-unknown-unknown/release/redevplugin_io_smoke_worker.wasm /out/io.wasm'
  install -m 0755 "$runtime_cache/redevplugin-runtime" "$LINUX_TARGET_ROOT/redevplugin-runtime"
  install -m 0644 "$runtime_cache/.redevplugin-release-artifacts-verified.json" "$LINUX_TARGET_ROOT/.redevplugin-release-artifacts-verified.json"
  install -m 0644 "$runtime_cache/redevplugin-runtime.provenance.json" "$LINUX_TARGET_ROOT/redevplugin-runtime.provenance.json"
  install -m 0644 "$runtime_cache/redevplugin-runtime.sig" "$LINUX_TARGET_ROOT/redevplugin-runtime.sig"
  install -m 0644 "$runtime_cache/redevplugin-runtime.pem" "$LINUX_TARGET_ROOT/redevplugin-runtime.pem"
  mkdir -p "$LINUX_TARGET_ROOT/io-package/dist/assets" "$LINUX_TARGET_ROOT/io-package/dist/ui" "$LINUX_TARGET_ROOT/io-package/dist/workers"
  cp "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke/manifest.json" "$LINUX_TARGET_ROOT/io-package/dist/manifest.json"
  cp "$ROOT_DIR/assets/brand/redeven/png/app-icon-64.png" "$LINUX_TARGET_ROOT/io-package/dist/assets/icon.png"
  cp -a "$ROOT_DIR/scripts/fixtures/redevplugin_io_smoke/dist/ui/." "$LINUX_TARGET_ROOT/io-package/dist/ui/"
  cp "$LINUX_TARGET_ROOT/io.wasm" "$LINUX_TARGET_ROOT/io-package/dist/workers/io.wasm"
  GOWORK=off go run "github.com/floegence/redevplugin/v3/cmd/redevplugin@v${runtime_version}" package "$LINUX_TARGET_ROOT/io-package/dist" "$LINUX_TARGET_ROOT/io-smoke.redevplugin" >/dev/null
  # The Host needs clone3(CLONE_PIDFD) before the runtime installs its own
  # no-new-privileges and seccomp containment profile.
  LINUX_CONTAINER_ID=$(docker run -d --rm --platform linux/arm64 --security-opt seccomp=unconfined --name "redeven-plugin-smoke-${RANDOM}${RANDOM}" \
    -p "127.0.0.1:$LINUX_UI_PORT:$LINUX_UI_PORT" \
    -p "127.0.0.1:$FIXTURE_HTTP_PORT:$FIXTURE_HTTP_PORT" \
    -p "127.0.0.1:$FIXTURE_TCP_PORT:$FIXTURE_TCP_PORT" \
    -p "127.0.0.1:$FIXTURE_UDP_PORT:$FIXTURE_UDP_PORT/udp" \
    -v "$LINUX_TARGET_ROOT:/linux" "$image" sleep infinity)
  docker exec "$LINUX_CONTAINER_ID" sh -ceu 'printf smoke-password > /linux/password; mkdir -p /state /workspace /linux/report'
  FIXTURE_PORTS_JSON=$(node -e 'const [proxy,http,tcp,udp]=process.argv.slice(1).map(Number);console.log(JSON.stringify({http,ws:http,tcp,udp,local_ui_proxy:proxy,pid:0}))' "$LINUX_UI_PORT" "$FIXTURE_HTTP_PORT" "$FIXTURE_TCP_PORT" "$FIXTURE_UDP_PORT")
  node - "$LINUX_REPORT" "$LINUX_CONTAINER_ID" "$LINUX_UI_PORT" "$LINUX_INTERNAL_UI_PORT" "$FIXTURE_PORTS_JSON" "$runtime_version" <<'NODE'
const fs = require('node:fs');
const [file, containerID, localUIPort, internalLocalUIPort, ports, runtimeVersion] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({schema_version: 1, os: 'linux', arch: 'arm64', container_id: containerID, local_ui_port: Number(localUIPort), internal_local_ui_port: Number(internalLocalUIPort), server_pid: 0, ports: JSON.parse(ports), runtime_version: runtimeVersion, state_root: '/state', target: 'linux/arm64', runtime_starts: [], local_ui_bridge_urls: []}, null, 2)}\n`);
NODE
  printf '%s\n' "$LINUX_CONTAINER_ID" >"$REPORT_ROOT/linux-container-id.txt"
  start_linux_redeven initial
  start_fixture_server
}

start_linux_redeven() {
  local phase=$1 deadline
  rm -f "$LINUX_TARGET_ROOT/report/startup.json"
  docker exec "$LINUX_CONTAINER_ID" sh -ceu 'exec /linux/redeven run --mode desktop --presentation machine --state-root /state --local-ui-bind 127.0.0.1:'"$LINUX_INTERNAL_UI_PORT"' --password-file /linux/password --permission-policy execute_read_write --startup-report-file /linux/report/startup.json >> /linux/redeven.log 2>&1' &
  LINUX_REDEVEN_EXEC_PID=$!
  deadline=$((SECONDS + 180))
  until [[ -s "$LINUX_TARGET_ROOT/report/startup.json" ]] && node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));process.exit(r.status==="ready"?0:1)' "$LINUX_TARGET_ROOT/report/startup.json"; do
    [[ "$SECONDS" -lt "$deadline" ]] || { echo "Linux Local UI did not become ready" >&2; return 1; }
    kill -0 "$LINUX_REDEVEN_EXEC_PID" 2>/dev/null || { echo "Linux Redeven exited before readiness" >&2; return 1; }
    sleep 0.5
  done
  local previous_runtime_pid=$LINUX_RUNTIME_PID
  LINUX_RUNTIME_PID=$(node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));process.stdout.write(String(r.pid||0))' "$LINUX_TARGET_ROOT/report/startup.json")
  [[ "$LINUX_RUNTIME_PID" =~ ^[0-9]+$ && "$LINUX_RUNTIME_PID" -gt 1 ]] || { echo "Linux runtime PID is invalid" >&2; return 1; }
  node - "$LINUX_REPORT" "$phase" "$LINUX_RUNTIME_PID" "$previous_runtime_pid" <<'NODE'
const fs = require('node:fs');
const [file, phase, runtimePID, previousRuntimePID] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
if (previousRuntimePID) report.previous_local_ui_pid = Number(previousRuntimePID);
report.local_ui_pid = Number(runtimePID);
report.runtime_starts.push({ phase, pid: Number(runtimePID), started_at: new Date().toISOString() });
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
NODE
}

start_fixture_server() {
  local bridge_url deadline
  bridge_url=$(node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));process.stdout.write(String(r.local_ui_bridge_url||""))' "$LINUX_TARGET_ROOT/report/startup.json")
  [[ "$bridge_url" =~ ^http://127\.0\.0\.1:[0-9]+/$ ]] || { echo "Linux trusted Local UI bridge URL is invalid" >&2; return 1; }
  rm -f "$LINUX_TARGET_ROOT/server.json" "$LINUX_TARGET_ROOT/server.pid"
  docker exec "$LINUX_CONTAINER_ID" sh -ceu '
    /linux/io-server -bind 0.0.0.0 -http-port "$1" -tcp-port "$2" -udp-port "$3" -local-ui-proxy-port "$4" -local-ui-target "$5" -local-ui-rewrite-authority "$6" -local-ui-trusted-bridge > /linux/server.json 2>> /linux/server.log &
    echo $! > /linux/server.pid
  ' sh "$FIXTURE_HTTP_PORT" "$FIXTURE_TCP_PORT" "$FIXTURE_UDP_PORT" "$LINUX_UI_PORT" "$bridge_url" "127.0.0.1:$LINUX_INTERNAL_UI_PORT"
  LINUX_SERVER_PID=$(docker exec "$LINUX_CONTAINER_ID" sh -c 'cat /linux/server.pid')
  [[ "$LINUX_SERVER_PID" =~ ^[0-9]+$ && "$LINUX_SERVER_PID" -gt 1 ]] || { echo "Linux fixture server PID is invalid" >&2; return 1; }
  deadline=$((SECONDS + 60))
  until [[ -s "$LINUX_TARGET_ROOT/server.json" ]] && curl -fsS "http://127.0.0.1:$LINUX_UI_PORT/" >/dev/null 2>&1; do
    [[ "$SECONDS" -lt "$deadline" ]] || { echo "I/O fixture server did not become ready" >&2; return 1; }
    if ! linux_pid_active "$LINUX_SERVER_PID"; then
      echo "I/O fixture server exited before readiness" >&2
      tail -n 20 "$LINUX_TARGET_ROOT/server.log" >&2 || true
      return 1
    fi
    sleep 0.25
  done
  FIXTURE_PORTS_JSON=$(<"$LINUX_TARGET_ROOT/server.json")
  node -e 'const got=JSON.parse(process.argv[1]);const [proxy,http,tcp,udp]=process.argv.slice(2).map(Number);if(got.local_ui_proxy!==proxy||got.http!==http||got.ws!==http||got.tcp!==tcp||got.udp!==udp)process.exit(1)' "$FIXTURE_PORTS_JSON" "$LINUX_UI_PORT" "$FIXTURE_HTTP_PORT" "$FIXTURE_TCP_PORT" "$FIXTURE_UDP_PORT"
  printf '%s\n' "$FIXTURE_PORTS_JSON" >"$REPORT_ROOT/fixture-server.json"
  node - "$LINUX_REPORT" "$LINUX_SERVER_PID" "$FIXTURE_PORTS_JSON" "$bridge_url" <<'NODE'
const fs = require('node:fs');
const [file, serverPID, ports, bridgeURL] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
report.server_pid = Number(serverPID);
report.ports = JSON.parse(ports);
report.local_ui_bridge_urls.push(bridgeURL);
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
NODE
}

linux_pid_active() {
  local pid=$1
  docker exec "$LINUX_CONTAINER_ID" sh -c '
    test -r "/proc/$1/stat" || exit 1
    state=$(cut -d " " -f 3 "/proc/$1/stat")
    test "$state" != Z
  ' sh "$pid" >/dev/null 2>&1
}

stop_linux_redeven() {
  [[ -n "$LINUX_CONTAINER_ID" && "$LINUX_RUNTIME_PID" =~ ^[0-9]+$ ]] || return 0
  docker exec "$LINUX_CONTAINER_ID" sh -c 'kill -TERM "$1"' sh "$LINUX_RUNTIME_PID" >/dev/null 2>&1 || true
  local deadline=$((SECONDS + 30))
  while linux_pid_active "$LINUX_RUNTIME_PID"; do
    if [[ "$SECONDS" -ge "$deadline" ]]; then
      docker exec "$LINUX_CONTAINER_ID" sh -c 'kill -KILL "$1"' sh "$LINUX_RUNTIME_PID" >/dev/null 2>&1 || true
      break
    fi
    sleep 0.25
  done
  [[ -n "$LINUX_REDEVEN_EXEC_PID" ]] && wait "$LINUX_REDEVEN_EXEC_PID" 2>/dev/null || true
  if linux_pid_active "$LINUX_RUNTIME_PID"; then
    LINUX_PIDS_RELEASED=false
  fi
  LINUX_REDEVEN_EXEC_PID=
}

stop_fixture_server() {
  [[ -n "$LINUX_CONTAINER_ID" && "$LINUX_SERVER_PID" =~ ^[0-9]+$ ]] || return 0
  docker exec "$LINUX_CONTAINER_ID" sh -c 'kill -TERM "$1"' sh "$LINUX_SERVER_PID" >/dev/null 2>&1 || true
  local deadline=$((SECONDS + 10))
  while linux_pid_active "$LINUX_SERVER_PID"; do
    if [[ "$SECONDS" -ge "$deadline" ]]; then
      docker exec "$LINUX_CONTAINER_ID" sh -c 'kill -KILL "$1"' sh "$LINUX_SERVER_PID" >/dev/null 2>&1 || true
      break
    fi
    sleep 0.25
  done
  ! linux_pid_active "$LINUX_SERVER_PID"
}

restart_linux_redeven() {
  local previous_runtime_pid=$LINUX_RUNTIME_PID
  stop_fixture_server
  stop_linux_redeven
  LINUX_RUNTIME_PID=$previous_runtime_pid
  start_linux_redeven cold_restart
  start_fixture_server
  [[ "$LINUX_RUNTIME_PID" != "$previous_runtime_pid" ]] || { echo "Linux cold restart reused the previous PID" >&2; return 1; }
}

listener_pid() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -n -u | head -n 1
}

process_cwd() {
  lsof -nP -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

run_attach() {
  mkdir -p "$REPORT_ROOT"
  local electron_pid runtime_pid inspector_pid electron_cwd runtime_cwd running_root
  electron_pid=$(listener_pid "$CDP_PORT")
  runtime_pid=$(listener_pid "$LOCAL_UI_PORT")
  inspector_pid=$(listener_pid "$INSPECTOR_PORT")
  [[ "$electron_pid" =~ ^[0-9]+$ && "$runtime_pid" =~ ^[0-9]+$ ]] || { echo "running dev Desktop listeners were not found" >&2; return 1; }
  [[ "$inspector_pid" == "$electron_pid" ]] || { echo "CDP and inspector do not belong to the same Electron process" >&2; return 1; }
  electron_cwd=$(process_cwd "$electron_pid")
  runtime_cwd=$(process_cwd "$runtime_pid")
  [[ -n "$electron_cwd" && "$electron_cwd" == "$runtime_cwd" && "$(basename "$electron_cwd")" == "desktop" ]] || {
    echo "attached Electron/runtime cwd provenance is invalid" >&2
    return 1
  }
  running_root=$(cd -- "$electron_cwd/.." >/dev/null 2>&1 && pwd)
  local electron_command runtime_command startup_report state_root user_data_root
  electron_command=$(ps -p "$electron_pid" -o command=)
  runtime_command=$(ps -p "$runtime_pid" -o command=)
  [[ "$electron_command" == "$electron_cwd"/node_modules/*/Electron.app/Contents/MacOS/Electron* ]] || { echo "CDP listener is not this checkout's dev Electron" >&2; return 1; }
  [[ "$runtime_command" == "$runtime_cwd"/.bundle/*/redeven\ run* ]] || { echo "Local UI listener is not this checkout's bundled runtime" >&2; return 1; }
  startup_report=$(node -e 'const m=process.argv[1].match(/(?:^| )--startup-report-file ([^ ]+)/);if(m)process.stdout.write(m[1])' "$runtime_command")
  state_root=$(node -e 'const m=process.argv[1].match(/(?:^| )--state-root ([^ ]+)/);if(m)process.stdout.write(m[1])' "$runtime_command")
  [[ -f "$startup_report" && -d "$state_root" ]] || { echo "runtime startup report or state root is unavailable" >&2; return 1; }
  user_data_root=${REDEVEN_PLUGIN_SMOKE_ATTACH_USER_DATA_ROOT:-${REDEVEN_DESKTOP_USER_DATA_ROOT:-}}
  [[ -n "$user_data_root" && -d "$user_data_root" ]] || { echo "Desktop user-data root is unavailable; set REDEVEN_PLUGIN_SMOKE_ATTACH_USER_DATA_ROOT" >&2; return 1; }

  local smoke_commit running_commit runtime_meta runtime_status runtime_commit runtime_report_pid runtime_report_state runtime_open_readiness
  smoke_commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
  running_commit=$(git -C "$running_root" rev-parse HEAD)
  runtime_meta=$(node - "$startup_report" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  status: report.status,
  pid: report.pid,
  state_dir: report.state_dir,
  runtime_commit: report.runtime_service?.runtime_commit,
  runtime_version: report.runtime_service?.runtime_version,
  open_readiness: report.runtime_service?.open_readiness?.state,
}));
NODE
)
  runtime_commit=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).runtime_commit||""))' "$runtime_meta")
  runtime_status=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status||""))' "$runtime_meta")
  runtime_report_pid=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).pid||""))' "$runtime_meta")
  runtime_report_state=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).state_dir||""))' "$runtime_meta")
  runtime_open_readiness=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).open_readiness||""))' "$runtime_meta")
  [[ "$runtime_report_pid" == "$runtime_pid" && "$runtime_report_state" == "$state_root/local-environment" ]] || {
    echo "runtime startup provenance does not match the listeners" >&2
    return 1
  }
  [[ "$smoke_commit" == "$running_commit" && "$runtime_status" == "ready" && "$runtime_open_readiness" == "openable"
    && ( "$running_commit" == "$runtime_commit"* || "$runtime_commit" == "$running_commit"* ) ]] || {
    echo "smoke checkout, running checkout, and ready runtime provenance differ" >&2
    return 1
  }
  curl -fsS "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null
  curl -fsS "http://127.0.0.1:$CDP_PORT/json/list" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const pages=JSON.parse(s);if(!pages.some(p=>{try{return new URL(p.url).pathname.startsWith("/_redeven_proxy/env/")}catch{return false}}))process.exit(1)})'

  local config="$REPORT_ROOT/attach-config.json" output="$REPORT_ROOT/attach.json" versions
  versions=$(node -e 'const p=require(process.argv[1]);console.log(JSON.stringify({contracts:p.dependencies["@floegence/redevplugin-contracts"],ui:p.dependencies["@floegence/redevplugin-ui"]}))' "$running_root/internal/envapp/ui_src/package.json")
  node - "$config" "$SMOKE_ROOT" "$state_root" "$user_data_root" "$REPORT_ROOT" "$running_root" "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" "$running_commit" "$runtime_commit" "$electron_pid" "$runtime_pid" "$output" "$versions" <<'NODE'
const fs = require('node:fs');
const [file, root, stateRoot, userDataRoot, reportRoot, runningRoot, localUIPort, cdpPort, inspectorPort, runningCommit, runtimeCommit, electronPID, runtimePID, output, versions] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  mode: 'attach', phase: 'attached', root, stateRoot, userDataRoot, cacheRoot: null, tempRoot: null,
  reportRoot, runningRoot, playwrightRoot: `${runningRoot}/internal/envapp/ui_src/node_modules`,
  localUIPort: Number(localUIPort), cdpPort: Number(cdpPort), inspectorPort: Number(inspectorPort),
  commit: runningCommit, runningCommit, runtimeCommit,
  electronPID: Number(electronPID), runtimePID: Number(runtimePID),
  pids: [Number(electronPID), Number(runtimePID)], output, dependencies: JSON.parse(versions),
}, null, 2)}\n`);
NODE

  local status=0 electron_after runtime_after inspector_after electron_alive=false runtime_alive=false listeners_preserved=false
  node "$ROOT_DIR/scripts/smoke_desktop_plugins.mjs" "$config" || status=$?
  kill -0 "$electron_pid" 2>/dev/null && electron_alive=true
  kill -0 "$runtime_pid" 2>/dev/null && runtime_alive=true
  electron_after=$(listener_pid "$CDP_PORT")
  runtime_after=$(listener_pid "$LOCAL_UI_PORT")
  inspector_after=$(listener_pid "$INSPECTOR_PORT")
  [[ "$electron_after" == "$electron_pid" && "$runtime_after" == "$runtime_pid" && "$inspector_after" == "$electron_pid" ]] && listeners_preserved=true
  node - "$REPORT_ROOT/process-preservation.json" "$electron_pid" "$runtime_pid" "$electron_alive" "$runtime_alive" "$listeners_preserved" <<'NODE'
const fs = require('node:fs');
const [file, electronPID, runtimePID, electronAlive, runtimeAlive, listenersPreserved] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  electron_pid: Number(electronPID), runtime_pid: Number(runtimePID),
  electron_alive: electronAlive === 'true', runtime_alive: runtimeAlive === 'true',
  listeners_preserved: listenersPreserved === 'true', no_processes_stopped: true,
}, null, 2)}\n`);
NODE
  [[ "$electron_alive" == "true" && "$runtime_alive" == "true" && "$listeners_preserved" == "true" ]] || status=1
  node - "$REPORT_ROOT" <<'NODE'
const fs = require('node:fs'); const path = require('node:path');
const root = process.argv[2]; const read = (name) => { const file = path.join(root, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };
fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify({ schema_version: 1, mode: 'attach', attached: read('attach.json'), process_preservation: read('process-preservation.json') }, null, 2)}\n`);
NODE
  echo "plugin smoke evidence: $REPORT_ROOT"
  return "$status"
}

if [[ "$MODE" == "attach" ]]; then
  run_attach
  exit $?
fi

early_cleanup() {
  local status=$?
  trap - EXIT INT TERM
  stop_fixture_server || true
  [[ -f "$LINUX_TARGET_ROOT/server.log" ]] && cp "$LINUX_TARGET_ROOT/server.log" "$REPORT_ROOT/linux-proxy.log"
  [[ -f "$LINUX_TARGET_ROOT/redeven.log" ]] && cp "$LINUX_TARGET_ROOT/redeven.log" "$REPORT_ROOT/linux-redeven.log"
  stop_linux_redeven
  if [[ -n "$LINUX_CONTAINER_ID" ]]; then
    [[ "$LINUX_SERVER_PID" =~ ^[0-9]+$ ]] && docker exec "$LINUX_CONTAINER_ID" sh -c 'kill -TERM "$1"' sh "$LINUX_SERVER_PID" >/dev/null 2>&1 || true
    docker rm -f "$LINUX_CONTAINER_ID" >/dev/null 2>&1 || true
  fi
  exit "$status"
}

mkdir -p "$STATE_ROOT" "$USER_DATA_ROOT" "$CACHE_ROOT" "$TEMP_ROOT" "$REPORT_ROOT"
trap early_cleanup EXIT INT TERM
prepare_linux_target
LOCAL_UI_PORT="$LINUX_UI_PORT"
if [[ -n "$SEED_ROOT" ]]; then
  [[ -d "$SEED_ROOT/state" && -d "$SEED_ROOT/user-data" ]] || { echo "invalid task-owned smoke seed: $SEED_ROOT" >&2; exit 2; }
  case "$SEED_ROOT" in /tmp/redeven-plugin-*|/tmp/rdsmoke-*) ;; *) echo "smoke seed must be a task-owned /tmp state" >&2; exit 2;; esac
  cp -a "$SEED_ROOT/state/." "$STATE_ROOT/"
  cp -a "$SEED_ROOT/user-data/." "$USER_DATA_ROOT/"
  node - "$STATE_ROOT/catalog/local-environment.json" "$LOCAL_UI_PORT" "$STATE_ROOT/local-environment" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const port = Number(process.argv[3]);
const stateDir = process.argv[4];
const record = JSON.parse(fs.readFileSync(file, 'utf8'));
record.local_hosting ??= {};
record.local_hosting.state_dir = stateDir;
record.local_hosting.access ??= {};
record.local_hosting.access.local_ui_bind = `127.0.0.1:${port}`;
fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
NODE
fi

if [[ "$REUSE_SEED_STATE" != "1" ]]; then
  mkdir -p "$STATE_ROOT/catalog"
  now_ms=$(node -e 'console.log(Date.now())')
  cat >"$STATE_ROOT/catalog/local-environment.json" <<JSON
{
  "schema_version": 1,
  "record_kind": "local_environment",
  "id": "local",
  "label": "Local Environment",
  "pinned": true,
  "auto_runtime_probe_enabled": true,
  "created_at_ms": $now_ms,
  "updated_at_ms": $now_ms,
  "last_used_at_ms": $now_ms,
  "preferred_open_route": "local_host",
  "local_hosting": {
    "state_dir": "$STATE_ROOT/local-environment",
    "owner": "agent",
    "access": { "local_ui_bind": "127.0.0.1:$LOCAL_UI_PORT", "local_ui_password_configured": false }
  }
}
JSON
fi

descendants() {
  local parent=$1 child
  while IFS= read -r child; do
    [[ "$child" =~ ^[0-9]+$ ]] || continue
    printf '%s\n' "$child"
    descendants "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

capture_pids() {
  [[ -n "$LAUNCH_PID" ]] || return 0
  : >"$PID_FILE"
  printf '%s\n' "$LAUNCH_PID" >>"$PID_FILE"
  descendants "$LAUNCH_PID" >>"$PID_FILE"
  while IFS= read -r report; do
    node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));if(r.state_dir===process.argv[2]&&Number.isInteger(r.pid))console.log(r.pid)' "$report" "$STATE_ROOT/local-environment" 2>/dev/null || true
  done < <(find "$TEMP_ROOT" -type f -name startup-report.json -print 2>/dev/null) >>"$PID_FILE"
  sort -u -o "$PID_FILE" "$PID_FILE"
}

stop_owned() {
  capture_pids
  if [[ ! -s "$PID_FILE" ]]; then
    LAUNCH_PID=
    return 0
  fi
  local owned_pids=()
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] && owned_pids+=("$pid")
  done <"$PID_FILE"
  for pid in "${owned_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  sleep 1
  for pid in "${owned_pids[@]}"; do kill -KILL "$pid" 2>/dev/null || true; done
  [[ -n "$LAUNCH_PID" ]] && wait "$LAUNCH_PID" 2>/dev/null || true
  for pid in "${owned_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      PIDS_RELEASED=false
    fi
  done
  LAUNCH_PID=
}

cleanup() {
  local status=$?
  local linux_server_released=true container_removed=true
  trap - EXIT INT TERM
  stop_owned
  if ! stop_fixture_server; then
    linux_server_released=false
  fi
  [[ -f "$LINUX_TARGET_ROOT/server.log" ]] && cp "$LINUX_TARGET_ROOT/server.log" "$REPORT_ROOT/linux-proxy.log"
  [[ -f "$LINUX_TARGET_ROOT/redeven.log" ]] && cp "$LINUX_TARGET_ROOT/redeven.log" "$REPORT_ROOT/linux-redeven.log"
  stop_linux_redeven
  if [[ -n "$LINUX_CONTAINER_ID" ]]; then
    docker rm -f "$LINUX_CONTAINER_ID" >/dev/null 2>&1 || true
    docker inspect "$LINUX_CONTAINER_ID" >/dev/null 2>&1 && container_removed=false
  fi
  ports_released=true
  node -e 'const n=require("node:net");const ps=process.argv.slice(1).map(Number).filter(p=>Number.isInteger(p)&&p>0);Promise.all(ps.map(p=>new Promise((r,j)=>{const s=n.createServer();s.once("error",j);s.listen(p,"127.0.0.1",()=>s.close(r))}))).then(()=>process.exit(0),()=>process.exit(1))' "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" "$FIXTURE_HTTP_PORT" "$FIXTURE_TCP_PORT" || { ports_released=false; status=1; }
  udp_port_released=true
  node -e 'const d=require("node:dgram");const p=Number(process.argv[1]);if(!Number.isInteger(p)||p<=0)process.exit(0);const s=d.createSocket("udp4");s.once("error",()=>process.exit(1));s.bind(p,"127.0.0.1",()=>s.close(()=>process.exit(0)))' "$FIXTURE_UDP_PORT" || { udp_port_released=false; status=1; }
  [[ "$PIDS_RELEASED" == "true" && "$LINUX_PIDS_RELEASED" == "true" && "$linux_server_released" == "true" && "$container_removed" == "true" ]] || status=1
  node - "$REPORT_ROOT/cleanup.json" "$PIDS_RELEASED" "$ports_released" "$LINUX_PIDS_RELEASED" "$linux_server_released" "$container_removed" "$udp_port_released" "$LINUX_RUNTIME_PID" "$LINUX_SERVER_PID" <<'NODE'
const fs = require('node:fs');
const [file, pidsReleased, portsReleased, linuxPIDsReleased, linuxServerReleased, containerRemoved, udpPortReleased, linuxRuntimePID, linuxServerPID] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  pids_released: pidsReleased === 'true',
  ports_released: portsReleased === 'true',
  linux_pids_released: linuxPIDsReleased === 'true',
  linux_server_released: linuxServerReleased === 'true',
  container_removed: containerRemoved === 'true',
  udp_port_released: udpPortReleased === 'true',
  linux_runtime_pid: Number(linuxRuntimePID || 0),
  linux_server_pid: Number(linuxServerPID || 0),
}, null, 2)}\n`);
NODE
  node -e 'const f=require("node:fs");const p=require("node:path");const root=process.argv[1];const read=(name)=>{const file=p.join(root,name);return f.existsSync(file)?JSON.parse(f.readFileSync(file)):null};const result={schema_version:1,initial:read("initial.json"),cold_restart:read("cold_restart.json"),cleanup:JSON.parse(f.readFileSync(p.join(root,"cleanup.json")))};f.writeFileSync(p.join(root,"summary.json"),JSON.stringify(result,null,2)+"\n")' "$REPORT_ROOT"
  echo "plugin smoke evidence: $REPORT_ROOT"
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_cdp() {
  local deadline=$((SECONDS + 180))
  until curl -fsS "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; do
    [[ "$SECONDS" -lt "$deadline" ]] || { echo "Desktop CDP readiness timed out" >&2; return 1; }
    kill -0 "$LAUNCH_PID" 2>/dev/null || { echo "Desktop exited before CDP readiness" >&2; return 1; }
    sleep 0.25
  done
}

run_phase() {
  local phase=$1
  local output="$REPORT_ROOT/$phase.json"
  local config="$REPORT_ROOT/$phase-config.json"
  : >"$PID_FILE"
  : >"$DESKTOP_LOG"
  REDEVEN_STATE_ROOT="$STATE_ROOT" \
  REDEVEN_DESKTOP_USER_DATA_ROOT="$USER_DATA_ROOT" \
  REDEVEN_DESKTOP_CACHE_ROOT="$CACHE_ROOT" \
  REDEVEN_DESKTOP_TEMP_ROOT="$TEMP_ROOT" \
  REDEVEN_DESKTOP_AUTO_START_RUNTIME=0 \
  REDEVEN_AGENT_FORCE_INSTALL=1 \
    "$ROOT_DIR/scripts/dev_desktop.sh" --no-stop --no-devtools \
      --remote-debugging-port "$CDP_PORT" --inspect-port "$INSPECTOR_PORT" >"$DESKTOP_LOG" 2>&1 &
  LAUNCH_PID=$!
  wait_cdp
  capture_pids
  commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
  versions=$(node -e 'const p=require(process.argv[1]);console.log(JSON.stringify({contracts:p.dependencies["@floegence/redevplugin-contracts"],ui:p.dependencies["@floegence/redevplugin-ui"]}))' "$ROOT_DIR/internal/envapp/ui_src/package.json")
  pids=$(node -e 'const f=require("node:fs");console.log(JSON.stringify(f.readFileSync(process.argv[1],"utf8").trim().split(/\s+/).filter(Boolean).map(Number)))' "$PID_FILE")
  seed_meta='null'
  if [[ -n "$SEED_ROOT" ]]; then
    seed_commit=$(git -C "$SEED_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)
    seed_hash=$(shasum -a 256 "$SEED_ROOT/state/catalog/local-environment.json" | awk '{print $1}')
    seed_meta=$(node -e 'console.log(JSON.stringify({root:process.argv[1],commit:process.argv[2],catalog_sha256:process.argv[3]}))' "$SEED_ROOT" "$seed_commit" "$seed_hash")
  fi
  node - "$config" <<JSON
const fs = require('node:fs');
const file = process.argv[2];
fs.writeFileSync(file, JSON.stringify({phase:"$phase",root:"$SMOKE_ROOT",stateRoot:"$STATE_ROOT",reusedTaskState:$([[ "$REUSE_SEED_STATE" == "1" ]] && echo true || echo false),seed:$seed_meta,userDataRoot:"$USER_DATA_ROOT",cacheRoot:"$CACHE_ROOT",tempRoot:"$TEMP_ROOT",reportRoot:"$REPORT_ROOT",playwrightRoot:"$ROOT_DIR/internal/envapp/ui_src/node_modules",localUIPort:$LOCAL_UI_PORT,cdpPort:$CDP_PORT,inspectorPort:$INSPECTOR_PORT,commit:"$commit",dependencies:$versions,pids:$pids,output:"$output",initialOutput:"$REPORT_ROOT/initial.json",externalLocalUIURL:"http://127.0.0.1:$LOCAL_UI_PORT/",ioPackagePath:"$LINUX_TARGET_ROOT/io-smoke.redevplugin",fixturePorts:$FIXTURE_PORTS_JSON,linuxTarget:JSON.parse(require('node:fs').readFileSync("$LINUX_REPORT"))}, null, 2)+"\n");
JSON
  node "$ROOT_DIR/scripts/smoke_desktop_plugins.mjs" "$config"
  stop_owned
}

run_phase initial
restart_linux_redeven
run_phase cold_restart
