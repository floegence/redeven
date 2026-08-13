#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
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

reserve_port() {
  node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
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
  local electron_command runtime_command startup_report state_root owner_file user_data_root
  electron_command=$(ps -p "$electron_pid" -o command=)
  runtime_command=$(ps -p "$runtime_pid" -o command=)
  [[ "$electron_command" == "$electron_cwd"/node_modules/*/Electron.app/Contents/MacOS/Electron* ]] || { echo "CDP listener is not this checkout's dev Electron" >&2; return 1; }
  [[ "$runtime_command" == "$runtime_cwd"/.bundle/*/redeven\ run* ]] || { echo "Local UI listener is not this checkout's bundled runtime" >&2; return 1; }
  startup_report=$(node -e 'const m=process.argv[1].match(/(?:^| )--startup-report-file ([^ ]+)/);if(m)process.stdout.write(m[1])' "$runtime_command")
  state_root=$(node -e 'const m=process.argv[1].match(/(?:^| )--state-root ([^ ]+)/);if(m)process.stdout.write(m[1])' "$runtime_command")
  [[ -f "$startup_report" && -d "$state_root" ]] || { echo "runtime startup report or state root is unavailable" >&2; return 1; }
  owner_file=${REDEVEN_PLUGIN_SMOKE_ATTACH_OWNER_FILE:-$HOME/Library/Application Support/@floegence/redeven-desktop/desktop-runtime-owner.json}
  [[ -f "$owner_file" ]] || { echo "Desktop runtime owner file is unavailable" >&2; return 1; }
  user_data_root=$(dirname "$owner_file")

  local smoke_commit running_commit runtime_meta runtime_status runtime_commit runtime_report_pid runtime_report_state runtime_open_readiness owner_id report_owner
  smoke_commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
  running_commit=$(git -C "$running_root" rev-parse HEAD)
  runtime_meta=$(node - "$startup_report" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  status: report.status,
  pid: report.pid,
  state_dir: report.state_dir,
  desktop_owner_id: report.desktop_owner_id,
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
  report_owner=$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).desktop_owner_id||""))' "$runtime_meta")
  owner_id=$(node -e 'const f=require("node:fs");process.stdout.write(String(JSON.parse(f.readFileSync(process.argv[1])).owner_id||""))' "$owner_file")
  [[ "$runtime_report_pid" == "$runtime_pid" && "$runtime_report_state" == "$state_root/local-environment" && -n "$owner_id" && "$owner_id" == "$report_owner" ]] || {
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
  node - "$config" "$SMOKE_ROOT" "$state_root" "$user_data_root" "$REPORT_ROOT" "$running_root" "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" "$owner_id" "$running_commit" "$runtime_commit" "$electron_pid" "$runtime_pid" "$output" "$versions" <<'NODE'
const fs = require('node:fs');
const [file, root, stateRoot, userDataRoot, reportRoot, runningRoot, localUIPort, cdpPort, inspectorPort, ownerID, runningCommit, runtimeCommit, electronPID, runtimePID, output, versions] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  mode: 'attach', phase: 'attached', root, stateRoot, userDataRoot, cacheRoot: null, tempRoot: null,
  reportRoot, runningRoot, playwrightRoot: `${runningRoot}/internal/envapp/ui_src/node_modules`,
  localUIPort: Number(localUIPort), cdpPort: Number(cdpPort), inspectorPort: Number(inspectorPort),
  ownerID, commit: runningCommit, runningCommit, runtimeCommit,
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

mkdir -p "$STATE_ROOT" "$USER_DATA_ROOT" "$CACHE_ROOT" "$TEMP_ROOT" "$REPORT_ROOT"
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
  trap - EXIT INT TERM
  stop_owned
  ports_released=true
  node -e 'const n=require("node:net");const ps=process.argv.slice(1).map(Number);Promise.all(ps.map(p=>new Promise((r,j)=>{const s=n.createServer();s.once("error",j);s.listen(p,"127.0.0.1",()=>s.close(r))}))).then(()=>process.exit(0),()=>process.exit(1))' "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" || { ports_released=false; status=1; }
  [[ "$PIDS_RELEASED" == "true" ]] || status=1
  printf '{"pids_released":%s,"ports_released":%s}\n' "$PIDS_RELEASED" "$ports_released" >"$REPORT_ROOT/cleanup.json"
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
  REDEVEN_DESKTOP_AUTO_START_RUNTIME=1 \
  REDEVEN_AGENT_FORCE_INSTALL=1 \
    "$ROOT_DIR/scripts/dev_desktop.sh" --no-stop --no-devtools \
      --remote-debugging-port "$CDP_PORT" --inspect-port "$INSPECTOR_PORT" >"$DESKTOP_LOG" 2>&1 &
  LAUNCH_PID=$!
  wait_cdp
  capture_pids
  owner_id=$(node -e 'const f=require("node:fs");const p=process.argv[1];console.log(f.existsSync(p)?JSON.parse(f.readFileSync(p)).owner_id:"")' "$USER_DATA_ROOT/desktop-runtime-owner.json")
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
fs.writeFileSync(file, JSON.stringify({phase:"$phase",root:"$SMOKE_ROOT",stateRoot:"$STATE_ROOT",reusedTaskState:$([[ "$REUSE_SEED_STATE" == "1" ]] && echo true || echo false),seed:$seed_meta,userDataRoot:"$USER_DATA_ROOT",cacheRoot:"$CACHE_ROOT",tempRoot:"$TEMP_ROOT",reportRoot:"$REPORT_ROOT",playwrightRoot:"$ROOT_DIR/internal/envapp/ui_src/node_modules",localUIPort:$LOCAL_UI_PORT,cdpPort:$CDP_PORT,inspectorPort:$INSPECTOR_PORT,ownerID:"$owner_id",commit:"$commit",dependencies:$versions,pids:$pids,output:"$output"}, null, 2)+"\n");
JSON
  node "$ROOT_DIR/scripts/smoke_desktop_plugins.mjs" "$config"
  stop_owned
}

run_phase initial
run_phase cold_restart
