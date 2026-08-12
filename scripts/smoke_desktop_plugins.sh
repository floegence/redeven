#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
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

reserve_port() {
  node -e 'const n=require("node:net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

LOCAL_UI_PORT=${REDEVEN_PLUGIN_SMOKE_LOCAL_UI_PORT:-$(reserve_port)}
CDP_PORT=${REDEVEN_PLUGIN_SMOKE_CDP_PORT:-$(reserve_port)}
INSPECTOR_PORT=${REDEVEN_PLUGIN_SMOKE_INSPECTOR_PORT:-$(reserve_port)}

mkdir -p "$STATE_ROOT" "$USER_DATA_ROOT" "$CACHE_ROOT" "$TEMP_ROOT" "$REPORT_ROOT"
if [[ -n "$SEED_ROOT" ]]; then
  [[ -d "$SEED_ROOT/state" && -d "$SEED_ROOT/user-data" ]] || { echo "invalid task-owned smoke seed: $SEED_ROOT" >&2; exit 2; }
  case "$SEED_ROOT" in /tmp/redeven-plugin-*|/tmp/rdsmoke-*) ;; *) echo "smoke seed must be a task-owned /tmp state" >&2; exit 2;; esac
  if [[ "$REUSE_SEED_STATE" == "1" ]]; then
    STATE_ROOT="$SEED_ROOT/state"
    LOCAL_UI_PORT=$(node -e 'const f=require("node:fs");const v=JSON.parse(f.readFileSync(process.argv[1]));console.log(new URL(`http://${v.local_hosting.access.local_ui_bind}`).port)' "$STATE_ROOT/catalog/local-environment.json")
    [[ -f "$SEED_ROOT/user-data/desktop-runtime-owner.json" ]] && cp "$SEED_ROOT/user-data/desktop-runtime-owner.json" "$USER_DATA_ROOT/"
  else
    cp -a "$SEED_ROOT/state/." "$STATE_ROOT/"
    cp -a "$SEED_ROOT/user-data/." "$USER_DATA_ROOT/"
  fi
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
  : >"$PID_FILE"
  [[ -n "$LAUNCH_PID" ]] || return 0
  printf '%s\n' "$LAUNCH_PID" >>"$PID_FILE"
  descendants "$LAUNCH_PID" >>"$PID_FILE"
  while IFS= read -r report; do
    node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));if(r.state_dir===process.argv[2]&&Number.isInteger(r.pid))console.log(r.pid)' "$report" "$STATE_ROOT/local-environment" 2>/dev/null || true
  done < <(find "$TEMP_ROOT" -type f -name startup-report.json -print 2>/dev/null) >>"$PID_FILE"
  sort -u -o "$PID_FILE" "$PID_FILE"
}

stop_owned() {
  capture_pids
  [[ -s "$PID_FILE" ]] || return 0
  local owned_pids=()
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] && owned_pids+=("$pid")
  done <"$PID_FILE"
  for pid in "${owned_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  sleep 1
  for pid in "${owned_pids[@]}"; do kill -KILL "$pid" 2>/dev/null || true; done
  wait "$LAUNCH_PID" 2>/dev/null || true
  LAUNCH_PID=
}

cleanup() {
  local status=$?
  stop_owned
  ports_released=true
  node -e 'const n=require("node:net");const ps=process.argv.slice(1).map(Number);Promise.all(ps.map(p=>new Promise((r,j)=>{const s=n.createServer();s.once("error",j);s.listen(p,"127.0.0.1",()=>s.close(r))}))).then(()=>process.exit(0),()=>process.exit(1))' "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" || { ports_released=false; status=1; }
  printf '{"pids_released":true,"ports_released":%s}\n' "$ports_released" >"$REPORT_ROOT/cleanup.json"
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
  cat >"$config" <<JSON
{"phase":"$phase","root":"$SMOKE_ROOT","stateRoot":"$STATE_ROOT","reusedTaskState":$([[ "$REUSE_SEED_STATE" == "1" ]] && echo true || echo false),"userDataRoot":"$USER_DATA_ROOT","cacheRoot":"$CACHE_ROOT","tempRoot":"$TEMP_ROOT","reportRoot":"$REPORT_ROOT","playwrightRoot":"$ROOT_DIR/internal/envapp/ui_src/node_modules","localUIPort":$LOCAL_UI_PORT,"cdpPort":$CDP_PORT,"inspectorPort":$INSPECTOR_PORT,"ownerID":"$owner_id","commit":"$commit","dependencies":$versions,"pids":$pids,"output":"$output"}
JSON
  node "$ROOT_DIR/scripts/smoke_desktop_plugins.mjs" "$config"
  stop_owned
}

run_phase initial
run_phase cold_restart
node -e 'const f=require("node:fs");const p=require("node:path");const root=process.argv[1];const result={schema_version:1,initial:JSON.parse(f.readFileSync(p.join(root,"initial.json"))),cold_restart:JSON.parse(f.readFileSync(p.join(root,"cold_restart.json")))};f.writeFileSync(p.join(root,"summary.json"),JSON.stringify(result,null,2)+"\n")' "$REPORT_ROOT"
