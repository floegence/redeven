#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
SMOKE_ROOT=/tmp/redeven-flower-smoke-01a00852
STATE_ROOT="$SMOKE_ROOT/state"
RUNTIME_STATE_ROOT="$STATE_ROOT/local-environment"
USER_DATA_ROOT="$SMOKE_ROOT/user-data"
CACHE_ROOT="$SMOKE_ROOT/cache"
TEMP_ROOT="$SMOKE_ROOT/temp"
WORKSPACE_ROOT="$SMOKE_ROOT/workspace"
REPORT_ROOT="$SMOKE_ROOT/report"
SOURCE_STATE_ROOT="${REDEVEN_FLOWER_SMOKE_SOURCE_STATE_ROOT:-$HOME/.redeven/local-environment}"
LOCAL_UI_PORT=43924
CDP_PORT=43925
INSPECTOR_PORT=43926
MANIFEST_FILE="$REPORT_ROOT/pid-manifest.json"
PROVIDER_METADATA_FILE="$REPORT_ROOT/provider.json"
DESKTOP_LOG="$REPORT_ROOT/desktop.log"
LAUNCH_PID=
RUNTIME_PID=
SOURCE_CONFIG_HASH_BEFORE=
SOURCE_SECRETS_HASH_BEFORE=
INITIAL_GIT_STATUS=
CLEANUP_STARTED=false

[[ $# -eq 0 ]] || { echo "usage: $0" >&2; exit 2; }

if [[ -e "$SMOKE_ROOT" ]]; then
  echo "Flower smoke root already exists; refusing to overwrite $SMOKE_ROOT" >&2
  exit 2
fi

node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" check-ports "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT"

mkdir -p "$STATE_ROOT/catalog" "$RUNTIME_STATE_ROOT" "$USER_DATA_ROOT" "$CACHE_ROOT" "$TEMP_ROOT" "$WORKSPACE_ROOT" "$REPORT_ROOT"
SOURCE_CONFIG_HASH_BEFORE=$(shasum -a 256 "$SOURCE_STATE_ROOT/config.json" | awk '{print $1}')
SOURCE_SECRETS_HASH_BEFORE=$(shasum -a 256 "$SOURCE_STATE_ROOT/secrets.json" | awk '{print $1}')
INITIAL_GIT_STATUS=$(git -C "$ROOT_DIR" status --porcelain=v1)

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
    "state_dir": "$RUNTIME_STATE_ROOT",
    "owner": "agent",
    "access": {
      "local_ui_bind": "127.0.0.1:$LOCAL_UI_PORT",
      "local_ui_password_configured": false
    }
  }
}
JSON

printf 'FLOWER_REFERENCE_MARKER_01a00852\n' >"$WORKSPACE_ROOT/reference-marker-with-a-deliberately-long-file-name-for-overflow-validation.txt"
printf 'FLOWER_ATTACHMENT_KEEP_01a00852\n' >"$WORKSPACE_ROOT/attachment-keep-with-a-deliberately-long-file-name-for-overflow-validation.txt"
printf 'FLOWER_ATTACHMENT_REMOVE_01a00852\n' >"$WORKSPACE_ROOT/attachment-remove.txt"
mkdir -p "$WORKSPACE_ROOT/reference-directory"
printf 'FLOWER_DIRECTORY_MARKER_01a00852\n' >"$WORKSPACE_ROOT/reference-directory/nested.txt"

descendants() {
  local parent=$1 child
  while IFS= read -r child; do
    [[ "$child" =~ ^[0-9]+$ ]] || continue
    printf '%s\n' "$child"
    descendants "$child"
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

capture_manifest() {
  [[ -n "$LAUNCH_PID" ]] || return 0
  local commit pids startup_report runtime_pid
  commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
  pids=$(printf '%s\n' "$LAUNCH_PID"; descendants "$LAUNCH_PID")
  while IFS= read -r startup_report; do
    runtime_pid=$(node -e 'const f=require("node:fs");const r=JSON.parse(f.readFileSync(process.argv[1]));if(f.realpathSync(r.state_dir)===f.realpathSync(process.argv[2])&&Number.isInteger(r.pid))process.stdout.write(String(r.pid))' \
      "$startup_report" "$RUNTIME_STATE_ROOT" 2>/dev/null || true)
    [[ "$runtime_pid" =~ ^[0-9]+$ ]] && pids=$(printf '%s\n%s\n' "$pids" "$runtime_pid")
  done < <(find "$TEMP_ROOT" -type f -name startup-report.json -print 2>/dev/null)
  pids=$(printf '%s\n' "$pids" | awk '/^[0-9]+$/' | sort -n -u)
  PID_VALUES="$pids" node - "$MANIFEST_FILE" "$ROOT_DIR" "$STATE_ROOT" "$commit" <<'NODE'
const fs = require('node:fs');
const [file, worktree, stateRoot, commit] = process.argv.slice(2);
const pids = String(process.env.PID_VALUES ?? '').split(/\s+/u).filter(Boolean).map(Number);
fs.writeFileSync(file, `${JSON.stringify({
  schema_version: 1, worktree, stateRoot, commit,
  ports: { local_ui: 43924, cdp: 43925, inspector: 43926 }, pids,
}, null, 2)}\n`, { mode: 0o600 });
NODE
}

stop_owned() {
  [[ -f "$MANIFEST_FILE" ]] || return 0
  capture_manifest
  local owned_pids pid
  owned_pids=$(node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" owned-pids "$MANIFEST_FILE")
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done <<<"$owned_pids"
  local deadline=$((SECONDS + 8)) alive
  while (( SECONDS < deadline )); do
    alive=false
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[0-9]+$ ]] || continue
      kill -0 "$pid" 2>/dev/null && alive=true
    done <<<"$owned_pids"
    [[ "$alive" == false ]] && break
    sleep 0.2
  done
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done <<<"$owned_pids"
  [[ -n "$LAUNCH_PID" ]] && wait "$LAUNCH_PID" 2>/dev/null || true
}

cleanup() {
  local status=$?
  [[ "$CLEANUP_STARTED" == false ]] || exit "$status"
  CLEANUP_STARTED=true
  trap - EXIT INT TERM
  stop_owned

  local secret_leak_found=false source_unchanged=false git_unchanged=false ports_released=false provider_state_removed=false
  if ! node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" scan-source-secret "$SOURCE_STATE_ROOT" "$REPORT_ROOT" "$ROOT_DIR"; then
    secret_leak_found=true
    status=1
  fi
  if node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" remove-provider "$RUNTIME_STATE_ROOT"; then
    provider_state_removed=true
  else
    status=1
  fi
  source_config_hash_after=$(shasum -a 256 "$SOURCE_STATE_ROOT/config.json" | awk '{print $1}')
  source_secrets_hash_after=$(shasum -a 256 "$SOURCE_STATE_ROOT/secrets.json" | awk '{print $1}')
  [[ "$SOURCE_CONFIG_HASH_BEFORE" == "$source_config_hash_after" && "$SOURCE_SECRETS_HASH_BEFORE" == "$source_secrets_hash_after" ]] && source_unchanged=true || status=1
  FINAL_GIT_STATUS=$(git -C "$ROOT_DIR" status --porcelain=v1)
  [[ "$INITIAL_GIT_STATUS" == "$FINAL_GIT_STATUS" ]] && git_unchanged=true || status=1
  node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" check-ports "$LOCAL_UI_PORT" "$CDP_PORT" "$INSPECTOR_PORT" && ports_released=true || status=1
  node - "$REPORT_ROOT/cleanup.json" "$REPORT_ROOT/result.json" "$secret_leak_found" "$source_unchanged" "$git_unchanged" "$ports_released" "$provider_state_removed" <<'NODE'
const fs = require('node:fs');
const [file, resultFile, secretLeakFound, sourceUnchanged, gitUnchanged, portsReleased, providerStateRemoved] = process.argv.slice(2);
const cleanup = {
  secret_leak_found: secretLeakFound === 'true',
  source_state_unchanged: sourceUnchanged === 'true',
  worktree_status_unchanged: gitUnchanged === 'true',
  ports_released: portsReleased === 'true',
  provider_state_removed: providerStateRemoved === 'true',
};
fs.writeFileSync(file, `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 });
if (fs.existsSync(resultFile)) {
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  result.cleanup = cleanup;
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}
NODE
  echo "Flower smoke evidence: $REPORT_ROOT"
  exit "$status"
}
trap cleanup EXIT INT TERM

node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" prepare-provider \
  "$SOURCE_STATE_ROOT" "$RUNTIME_STATE_ROOT" "$PROVIDER_METADATA_FILE"

REDEVEN_STATE_ROOT="$STATE_ROOT" \
REDEVEN_DESKTOP_USER_DATA_ROOT="$USER_DATA_ROOT" \
REDEVEN_DESKTOP_CACHE_ROOT="$CACHE_ROOT" \
REDEVEN_DESKTOP_TEMP_ROOT="$TEMP_ROOT" \
REDEVEN_DESKTOP_LOCAL_UI_BIND="127.0.0.1:$LOCAL_UI_PORT" \
REDEVEN_DESKTOP_AUTO_START_RUNTIME=1 \
REDEVEN_AGENT_FORCE_INSTALL=1 \
  "$ROOT_DIR/scripts/dev_desktop.sh" --no-stop --no-devtools \
    --remote-debugging-port "$CDP_PORT" --inspect-port "$INSPECTOR_PORT" >"$DESKTOP_LOG" 2>&1 &
LAUNCH_PID=$!

deadline=$((SECONDS + 240))
until curl -fsS "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; do
  [[ "$SECONDS" -lt "$deadline" ]] || { echo "Flower smoke Desktop CDP readiness timed out" >&2; exit 1; }
  kill -0 "$LAUNCH_PID" 2>/dev/null || { echo "Flower smoke Desktop exited before CDP readiness" >&2; exit 1; }
  sleep 0.25
done
capture_manifest

runtime_report=
while [[ -z "$runtime_report" && "$SECONDS" -lt "$deadline" ]]; do
  runtime_report=$(find "$TEMP_ROOT" -type f -name startup-report.json -print -quit 2>/dev/null || true)
  [[ -n "$runtime_report" ]] || sleep 0.25
done
[[ -f "$runtime_report" ]] || { echo "Flower smoke runtime startup report is unavailable" >&2; exit 1; }
RUNTIME_PID=$(node - "$runtime_report" "$RUNTIME_STATE_ROOT" <<'NODE'
const fs = require('node:fs');
const [file, stateRoot] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
if (report.status !== 'ready' || fs.realpathSync(report.state_dir) !== fs.realpathSync(stateRoot) || !Number.isInteger(report.pid)) {
  throw new Error('runtime startup provenance does not match the Flower smoke');
}
process.stdout.write(String(report.pid));
NODE
)

commit=$(git -C "$ROOT_DIR" rev-parse HEAD)
node - "$REPORT_ROOT/run-config.json" "$ROOT_DIR" "$STATE_ROOT" "$USER_DATA_ROOT" "$CACHE_ROOT" "$TEMP_ROOT" "$WORKSPACE_ROOT" "$REPORT_ROOT" "$commit" "$RUNTIME_PID" <<'NODE'
const fs = require('node:fs');
const [file, worktree, stateRoot, userDataRoot, cacheRoot, tempRoot, workspace, reportRoot, commit, runtimePID] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  root: '/tmp/redeven-flower-smoke-01a00852', workspace, model: 'deepseek-v4-flash',
  localUIPort: 43924, cdpPort: 43925, inspectorPort: 43926,
  worktree, stateRoot, userDataRoot, cacheRoot, tempRoot, reportRoot, commit, runtimePID: Number(runtimePID),
  playwrightRoot: `${worktree}/internal/envapp/ui_src/node_modules`,
}, null, 2)}\n`, { mode: 0o600 });
NODE

node "$SCRIPT_DIR/smoke_flower_deepseek.mjs" run "$REPORT_ROOT/run-config.json"
