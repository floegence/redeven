#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="$ROOT_DIR/desktop"

# shellcheck source=scripts/ui_package_common.sh
source "$SCRIPT_DIR/ui_package_common.sh"

OPEN_DEVTOOLS="${REDEVEN_DESKTOP_OPEN_DEVTOOLS:-1}"
REMOTE_DEBUGGING_PORT="${REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT:-}"
INSPECT_PORT="${REDEVEN_DESKTOP_INSPECT_PORT:-}"
LOCAL_UI_BIND="${REDEVEN_DESKTOP_LOCAL_UI_BIND:-}"
STOP_EXISTING=1
STOP_ONLY=0
DRY_RUN=0
STOP_RUNTIMES=0
STOP_TIMEOUT_SECONDS="${REDEVEN_DESKTOP_STOP_TIMEOUT_SECONDS:-8}"
ELECTRON_ARGS=()
ELECTRON_DEBUG_ARGS=()
COLLECTED_PIDS=()
DEVELOPMENT_STATE_ROOT=""
DEVELOPMENT_OWNER=""
DEVELOPMENT_PORT_BASE=""
DEVELOPMENT_INSTANCE_ID=""
DEVELOPMENT_BUNDLE_ROOT=""
DEVELOPMENT_PORT_LEASE=""
DEVELOPMENT_PORT_LEASE_ROOT=""
DEVELOPMENT_DESKTOP_PID_FILE=""
PORTS_EXPLICIT=0

if [ -n "$REMOTE_DEBUGGING_PORT" ] || [ -n "$INSPECT_PORT" ] || [ -n "$LOCAL_UI_BIND" ]; then
	PORTS_EXPLICIT=1
fi

usage() {
  cat <<'USAGE'
Usage: ./scripts/dev_desktop.sh [options] [-- <electron-args>]

Build and start Redeven Desktop from this checkout/worktree. The bundled runtime
is built from the same uncommitted source tree before Electron starts.
The embedded Env App Plugin UI is enabled for this development launch.

Options:
  --no-devtools             Do not open Desktop DevTools automatically.
  --no-stop                 Skip stopping existing Redeven Desktop processes.
  --stop-only               Stop existing Redeven Desktop processes, then exit.
  --stop-runtimes           Also stop Redeven runtime processes (interrupts active work).
  --stop-timeout <seconds>  Seconds to wait before force-stopping processes (default: 8).
  --remote-debugging-port <port|0>
                            Electron Chrome DevTools Protocol port (checkout-derived default, 0 disables).
  --inspect-port <port|0>   Electron main-process inspector port (checkout-derived default, 0 disables).
  --dry-run                 Print the stop/start actions without changing processes.
  -h, --help                Show this help.

Environment:
  REDEVEN_DESKTOP_OPEN_DEVTOOLS=0|1
  REDEVEN_DESKTOP_AUTO_START_RUNTIME=0|1 (default: 1 for this development launch)
  REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT=<port|0> (overrides instance-derived default)
  REDEVEN_DESKTOP_INSPECT_PORT=<port|0> (overrides instance-derived default)
  REDEVEN_DESKTOP_LOCAL_UI_BIND=<loopback-host:port> (overrides instance-derived default)
  REDEVEN_STATE_ROOT=<absolute isolated profile root>
  REDEVEN_DEV_STATE_BASE=<absolute parent for the stable checkout profile>
  REDEVEN_DEV_ALLOW_USER_STATE_ROOT=1 (required to explicitly use ~/.redeven)
  REDEVEN_DESKTOP_TEMP_ROOT=<absolute task-owned temporary directory>
  REDEVEN_DESKTOP_STOP_TIMEOUT_SECONDS=<seconds>
  REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG=<vX.Y.Z|v0.0.0-dev>
  REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT=<redeven-checkout>
  REDEVEN_AGENT_FORCE_INSTALL=1
USAGE
}

die_usage() {
  ui_pkg_die "$*"
}

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' \t\r\n')" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_stop_timeout() {
  case "$STOP_TIMEOUT_SECONDS" in
    ''|*[!0-9]*)
      die_usage "--stop-timeout must be a non-negative integer"
      ;;
  esac
}

debug_port_disabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' \t\r\n')" in
    ''|0|false|no|off|disabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_debug_port() {
  local label="$1"
  local value="$2"

  if debug_port_disabled "$value"; then
    return 0
  fi
  case "$value" in
    *[!0-9]*)
      die_usage "$label must be a TCP port number, or 0 to disable it"
      ;;
  esac
  if [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    die_usage "$label must be between 1 and 65535, or 0 to disable it"
  fi
}

resolve_absolute_path() {
  local candidate="$1"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    let cursor = path.resolve(process.argv[1]);
    const suffix = [];
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
    const canonicalParent = fs.realpathSync.native(cursor);
    process.stdout.write(path.join(canonicalParent, ...suffix));
  ' "$candidate"
}

resolve_development_state_root() {
	local checkout_name checkout_checksum instance_checksum state_base explicit_root user_state_root uses_user_state_root

  checkout_name="$(printf '%s' "$(basename "$ROOT_DIR")" | tr -cs '[:alnum:]_.-' '-')"
  checkout_checksum="$(printf '%s' "$ROOT_DIR" | cksum | awk '{print $1}')"
	DEVELOPMENT_OWNER="${checkout_name}-${checkout_checksum}"
  explicit_root="${REDEVEN_STATE_ROOT:-}"
  if [ -n "$explicit_root" ]; then
    case "$explicit_root" in
      /*) ;;
      *) ui_pkg_die "REDEVEN_STATE_ROOT must be an absolute path for a development launch" ;;
    esac
    DEVELOPMENT_STATE_ROOT="$(resolve_absolute_path "$explicit_root")"
  else
    state_base="${REDEVEN_DEV_STATE_BASE:-${HOME:?HOME is required}/.redeven-dev}"
    case "$state_base" in
      /*) ;;
      *) ui_pkg_die "REDEVEN_DEV_STATE_BASE must be an absolute path" ;;
    esac
    DEVELOPMENT_STATE_ROOT="$(resolve_absolute_path "$state_base/$DEVELOPMENT_OWNER")"
	fi
	instance_checksum="$(printf '%s\0%s' "$ROOT_DIR" "$DEVELOPMENT_STATE_ROOT" | cksum | awk '{print $1}')"
	DEVELOPMENT_INSTANCE_ID="rdi-${instance_checksum}"
	DEVELOPMENT_PORT_BASE=$((24000 + (instance_checksum % 6000) * 4))
	DEVELOPMENT_PORT_LEASE_ROOT="$(resolve_absolute_path "${HOME:?HOME is required}/.redeven-dev/.port-leases")"
	DEVELOPMENT_DESKTOP_PID_FILE="$DEVELOPMENT_STATE_ROOT/desktop/dev-electron-v1.pid"

  user_state_root="$(resolve_absolute_path "${HOME:?HOME is required}/.redeven")"
  case "$DEVELOPMENT_STATE_ROOT/" in
    "$user_state_root"/*) uses_user_state_root=1 ;;
    *) uses_user_state_root=0 ;;
  esac
  if [ "$uses_user_state_root" -eq 1 ]; then
    if ! is_enabled "${REDEVEN_DEV_ALLOW_USER_STATE_ROOT:-0}"; then
      ui_pkg_die "development launch refuses the user state root; use an isolated REDEVEN_STATE_ROOT, or set REDEVEN_DEV_ALLOW_USER_STATE_ROOT=1 for an explicit high-risk opt-in"
    fi
    ui_pkg_log "WARNING: development launch explicitly uses the user state root: $DEVELOPMENT_STATE_ROOT"
  fi

  export REDEVEN_STATE_ROOT="$DEVELOPMENT_STATE_ROOT"
  export REDEVEN_DESKTOP_LOCAL_UI_BIND="$LOCAL_UI_BIND"
  export REDEVEN_DESKTOP_USER_DATA_ROOT="${REDEVEN_DESKTOP_USER_DATA_ROOT:-$DEVELOPMENT_STATE_ROOT/desktop/user-data}"
  export REDEVEN_DESKTOP_CACHE_ROOT="${REDEVEN_DESKTOP_CACHE_ROOT:-$DEVELOPMENT_STATE_ROOT/desktop/cache}"
	export REDEVEN_DESKTOP_TEMP_ROOT="${REDEVEN_DESKTOP_TEMP_ROOT:-$DEVELOPMENT_STATE_ROOT/desktop/temp}"
	export REDEVEN_DESKTOP_DEV_INSTANCE_ID="$DEVELOPMENT_INSTANCE_ID"
}

development_port_is_available() {
	local port="$1" allow_current_runtime="$2" pid
	if ! command -v lsof >/dev/null 2>&1; then
		ui_pkg_die "lsof is required to allocate isolated development ports"
	fi
	while IFS= read -r pid; do
		[ -n "$pid" ] || continue
		if [ "$allow_current_runtime" -eq 1 ] && process_is_current_development_runtime "$pid"; then
			continue
		fi
		return 1
	done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)
	return 0
}

acquire_development_port_lock() {
	local lock_path="$DEVELOPMENT_PORT_LEASE_ROOT/.allocation.lock" attempt
	mkdir -p "$DEVELOPMENT_PORT_LEASE_ROOT"
	chmod 700 "$DEVELOPMENT_PORT_LEASE_ROOT"
	for attempt in $(seq 1 100); do
		if mkdir "$lock_path" 2>/dev/null; then
			DEVELOPMENT_PORT_LEASE="$lock_path"
			return 0
		fi
		sleep 0.05
	done
	ui_pkg_die "timed out waiting for the development port allocation lock: $lock_path"
}

release_development_port_lock() {
	if [ -n "$DEVELOPMENT_PORT_LEASE" ]; then
		rmdir "$DEVELOPMENT_PORT_LEASE" 2>/dev/null || true
		DEVELOPMENT_PORT_LEASE=""
	fi
}

port_lease_available_locked() {
	local port="$1" owner_file owner
	owner_file="$DEVELOPMENT_PORT_LEASE_ROOT/port-$port.owner"
	if [ ! -e "$owner_file" ]; then
		return 0
	fi
	owner="$(sed -n '1p' "$owner_file" 2>/dev/null || true)"
	[ "$owner" = "$DEVELOPMENT_INSTANCE_ID" ]
}

claim_ports_locked() {
	local local_port="$1" cdp_port="$2" inspect_port="$3" port owner_file
	for port in "$local_port" "$cdp_port" "$inspect_port"; do
		debug_port_disabled "$port" && continue
		if ! port_lease_available_locked "$port"; then
			return 1
		fi
	done
	if [ "$DRY_RUN" -eq 0 ]; then
		for port in "$local_port" "$cdp_port" "$inspect_port"; do
			debug_port_disabled "$port" && continue
			owner_file="$DEVELOPMENT_PORT_LEASE_ROOT/port-$port.owner"
			if [ ! -e "$owner_file" ]; then
				(umask 077; printf '%s\n%s\n' "$DEVELOPMENT_INSTANCE_ID" "$DEVELOPMENT_STATE_ROOT" > "$owner_file")
			fi
		done
	fi
	return 0
}

allocate_development_ports() {
	local preferred_base candidate_base offset local_port cdp_port inspect_port explicit_local_port
	preferred_base="$DEVELOPMENT_PORT_BASE"
	if [ "$PORTS_EXPLICIT" -eq 1 ]; then
		explicit_local_port="${LOCAL_UI_BIND##*:}"
		local_port="${explicit_local_port:-$preferred_base}"
		cdp_port="${REMOTE_DEBUGGING_PORT:-$((preferred_base + 1))}"
		inspect_port="${INSPECT_PORT:-$((preferred_base + 2))}"
		LOCAL_UI_BIND="${LOCAL_UI_BIND:-localhost:$local_port}"
		REMOTE_DEBUGGING_PORT="$cdp_port"
		INSPECT_PORT="$inspect_port"
		validate_debug_port "REDEVEN_DESKTOP_LOCAL_UI_BIND port" "$local_port"
		validate_debug_port "--remote-debugging-port" "$cdp_port"
		validate_debug_port "--inspect-port" "$inspect_port"
		acquire_development_port_lock
		if ! claim_ports_locked "$local_port" "$cdp_port" "$inspect_port"; then
			release_development_port_lock
			ui_pkg_die "an explicit development port is reserved by another Redeven dev instance"
		fi
		release_development_port_lock
		return 0
	fi

	acquire_development_port_lock
	for offset in $(seq 0 5999); do
		candidate_base=$((24000 + (((preferred_base - 24000) / 4 + offset) % 6000) * 4))
		local_port="$candidate_base"
		cdp_port=$((candidate_base + 1))
		inspect_port=$((candidate_base + 2))
		if ! port_lease_available_locked "$local_port" || ! port_lease_available_locked "$cdp_port" || ! port_lease_available_locked "$inspect_port"; then
			continue
		fi
		if ! development_port_is_available "$local_port" 1 || ! development_port_is_available "$cdp_port" 0 || ! development_port_is_available "$inspect_port" 0; then
			continue
		fi
		claim_ports_locked "$local_port" "$cdp_port" "$inspect_port"
		DEVELOPMENT_PORT_BASE="$candidate_base"
		LOCAL_UI_BIND="localhost:$local_port"
		REMOTE_DEBUGGING_PORT="$cdp_port"
		INSPECT_PORT="$inspect_port"
		release_development_port_lock
		return 0
	done
	release_development_port_lock
	ui_pkg_die "no isolated development port window is available"
}

validate_local_ui_bind() {
  local port
  case "$LOCAL_UI_BIND" in
    localhost:*|127.0.0.1:*|'[::1]':*) ;;
    *) die_usage "REDEVEN_DESKTOP_LOCAL_UI_BIND must use localhost, 127.0.0.1, or [::1]" ;;
  esac
  port="${LOCAL_UI_BIND##*:}"
  validate_debug_port "REDEVEN_DESKTOP_LOCAL_UI_BIND port" "$port"
  if debug_port_disabled "$port"; then
    die_usage "REDEVEN_DESKTOP_LOCAL_UI_BIND must use a stable non-zero development port"
  fi
  if ! debug_port_disabled "$REMOTE_DEBUGGING_PORT" && [ "$port" = "$REMOTE_DEBUGGING_PORT" ]; then
    die_usage "Local UI and CDP ports must be different"
  fi
  if ! debug_port_disabled "$INSPECT_PORT" && [ "$port" = "$INSPECT_PORT" ]; then
    die_usage "Local UI and inspector ports must be different"
  fi
  if ! debug_port_disabled "$REMOTE_DEBUGGING_PORT" && ! debug_port_disabled "$INSPECT_PORT" \
    && [ "$REMOTE_DEBUGGING_PORT" = "$INSPECT_PORT" ]; then
    die_usage "CDP and inspector ports must be different"
  fi
}

electron_args_include_switch() {
  local switch_name="$1"
  local arg

  if [ "${#ELECTRON_ARGS[@]}" -eq 0 ]; then
    return 1
  fi
  for arg in "${ELECTRON_ARGS[@]}"; do
    if [ "$arg" = "$switch_name" ] || [[ "$arg" == "$switch_name="* ]]; then
      return 0
    fi
  done
  return 1
}

electron_args_include_inspect_switch() {
  local arg

  if [ "${#ELECTRON_ARGS[@]}" -eq 0 ]; then
    return 1
  fi
  for arg in "${ELECTRON_ARGS[@]}"; do
    case "$arg" in
      --inspect|--inspect=*|--inspect-brk|--inspect-brk=*)
        return 0
        ;;
    esac
  done
  return 1
}

build_electron_debug_args() {
  ELECTRON_DEBUG_ARGS=()

  if ! debug_port_disabled "$REMOTE_DEBUGGING_PORT" && ! electron_args_include_switch "--remote-debugging-port"; then
    if ! electron_args_include_switch "--remote-debugging-address"; then
      ELECTRON_DEBUG_ARGS+=("--remote-debugging-address=127.0.0.1")
    fi
    ELECTRON_DEBUG_ARGS+=("--remote-debugging-port=$REMOTE_DEBUGGING_PORT")
  fi

  if ! debug_port_disabled "$INSPECT_PORT" && ! electron_args_include_inspect_switch; then
    ELECTRON_DEBUG_ARGS+=("--inspect=127.0.0.1:$INSPECT_PORT")
  fi
}

resolve_ssh_runtime_release_tag() {
  local explicit_tag="${REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG:-}"

  if [ -n "$explicit_tag" ]; then
    printf '%s\n' "$explicit_tag"
    return 0
  fi

  printf '%s\n' "${REDEVEN_DESKTOP_BUNDLE_VERSION:-${REDEVEN_DESKTOP_VERSION:-v0.0.0-dev}}"
}

print_command() {
  local arg
  for arg in "$@"; do
    printf '%q ' "$arg"
  done
  printf '\n'
}

add_pid() {
  local pid="$1"
  local existing

  case "$pid" in
    ''|*[!0-9]*)
      return 0
      ;;
  esac
  if [ "$pid" -eq "$$" ]; then
    return 0
  fi

  if [ "${#COLLECTED_PIDS[@]}" -gt 0 ]; then
    for existing in "${COLLECTED_PIDS[@]}"; do
      if [ "$existing" = "$pid" ]; then
        return 0
      fi
    done
  fi
  COLLECTED_PIDS+=("$pid")
}

reset_collected_pids() {
  COLLECTED_PIDS=()
}

process_cwd() {
  local pid="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

collect_desktop_pids() {
	local pid command cwd
	reset_collected_pids
	[ -f "$DEVELOPMENT_DESKTOP_PID_FILE" ] || return 0
	pid="$(sed -n '1p' "$DEVELOPMENT_DESKTOP_PID_FILE" 2>/dev/null || true)"
	case "$pid" in
		''|*[!0-9]*) return 0 ;;
	esac
	command="$(process_command "$pid")"
	cwd="$(process_cwd "$pid" || true)"
	case "$command" in
		*"--redeven-dev-instance=$DEVELOPMENT_INSTANCE_ID"*) ;;
		*) return 0 ;;
	esac
	[ "$cwd" = "$DESKTOP_DIR" ] || return 0
	add_pid "$pid"
}

process_command() {
  ps -p "$1" -o command= 2>/dev/null || true
}

process_is_current_development_runtime() {
	local pid="$1" command
  command="$(process_command "$pid")"
  [ -n "$command" ] || return 1
	case "$command" in
		*"$DEVELOPMENT_STATE_ROOT/local-environment/runtime/managed/bin/redeven"*" run "*) ;;
		*) return 1 ;;
	esac
	case "$command" in
		*"--state-root $DEVELOPMENT_STATE_ROOT/local-environment"*|*"--state-root=$DEVELOPMENT_STATE_ROOT/local-environment"*) return 0 ;;
		*) return 1 ;;
	esac
}

stop_current_instance_runtime() {
	local managed_runtime="$DEVELOPMENT_STATE_ROOT/local-environment/runtime/managed/bin/redeven"
	local runtime_state_root="$DEVELOPMENT_STATE_ROOT/local-environment"
	if [ ! -x "$managed_runtime" ]; then
		ui_pkg_log "No managed Runtime is installed for this dev instance."
		return 0
	fi
	ui_pkg_log "Stopping the exact managed Runtime for instance $DEVELOPMENT_INSTANCE_ID via its verified process inventory."
	if [ "$DRY_RUN" -eq 1 ]; then
		print_command "$managed_runtime" desktop-runtime-stop --state-root "$runtime_state_root" --grace-period "${STOP_TIMEOUT_SECONDS}s"
		return 0
	fi
	"$managed_runtime" desktop-runtime-stop --state-root "$runtime_state_root" --grace-period "${STOP_TIMEOUT_SECONDS}s"
}

ensure_port_available() {
  local label="$1" port="$2" allow_current_runtime="$3" pid
  if debug_port_disabled "$port"; then
    return 0
  fi
  if ! command -v lsof >/dev/null 2>&1; then
    ui_pkg_die "lsof is required to verify that the $label port is available"
  fi
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if [ "$allow_current_runtime" -eq 1 ] && process_is_current_development_runtime "$pid"; then
      ui_pkg_log "$label port $port is owned by this checkout's runtime (pid $pid); Desktop will reuse that owner."
      continue
    fi
    ui_pkg_die "$label port $port is already in use by pid $pid; choose an unused development port"
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)
}

verify_development_ports() {
  local local_ui_port="${LOCAL_UI_BIND##*:}"
  ensure_port_available "Local UI" "$local_ui_port" 1
  ensure_port_available "CDP" "$REMOTE_DEBUGGING_PORT" 0
  ensure_port_available "main-process inspector" "$INSPECT_PORT" 0
}

pid_exists() {
  local pid="$1"
  kill -0 "$pid" >/dev/null 2>&1
}

any_pid_exists() {
  local pid
  for pid in "$@"; do
    if pid_exists "$pid"; then
      return 0
    fi
  done
  return 1
}

terminate_collected_pids() {
  local label="$1"
  local pid
  local forced=()
  local deadline

  if [ "${#COLLECTED_PIDS[@]}" -eq 0 ]; then
    ui_pkg_log "No existing $label processes found."
    return 0
  fi

  ui_pkg_log "Stopping $label processes: ${COLLECTED_PIDS[*]}"
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  for pid in "${COLLECTED_PIDS[@]}"; do
    kill -TERM "$pid" >/dev/null 2>&1 || true
  done

  deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! any_pid_exists "${COLLECTED_PIDS[@]}"; then
      return 0
    fi
    sleep 0.2
  done

  for pid in "${COLLECTED_PIDS[@]}"; do
    if pid_exists "$pid"; then
      forced+=("$pid")
    fi
  done

  if [ "${#forced[@]}" -gt 0 ]; then
    ui_pkg_log "Force-stopping $label processes: ${forced[*]}"
    for pid in "${forced[@]}"; do
      kill -KILL "$pid" >/dev/null 2>&1 || true
    done
  fi
}

stop_existing_processes() {
  if [ "$STOP_EXISTING" -ne 1 ]; then
    ui_pkg_log "Skipping existing process shutdown."
    return 0
  fi

  ui_pkg_log "Stopping existing Redeven Desktop processes owned by this checkout before launch..."
  collect_desktop_pids
  terminate_collected_pids "Redeven Desktop"
	if [ "$STOP_RUNTIMES" -eq 1 ]; then
		ui_pkg_log "Stopping Redeven runtime processes because --stop-runtimes was provided. This can interrupt active work."
		stop_current_instance_runtime
  else
    ui_pkg_log "Leaving existing Redeven runtime processes running."
  fi
}

log_development_configuration() {
	ui_pkg_log "Development checkout owner: $DEVELOPMENT_OWNER ($ROOT_DIR)"
	ui_pkg_log "Development instance identity: $DEVELOPMENT_INSTANCE_ID"
  ui_pkg_log "Development state root: $DEVELOPMENT_STATE_ROOT"
	ui_pkg_log "Development user data root: $REDEVEN_DESKTOP_USER_DATA_ROOT"
	ui_pkg_log "Development cache root: $REDEVEN_DESKTOP_CACHE_ROOT"
	ui_pkg_log "Development temp root: $REDEVEN_DESKTOP_TEMP_ROOT"
	ui_pkg_log "Development immutable bundle root: $DEVELOPMENT_STATE_ROOT/desktop/bundles"
  ui_pkg_log "Development Local UI: $LOCAL_UI_BIND"
  if debug_port_disabled "$REMOTE_DEBUGGING_PORT"; then
    ui_pkg_log "Development CDP port: disabled"
  else
    ui_pkg_log "Development CDP port: $REMOTE_DEBUGGING_PORT"
  fi
  if debug_port_disabled "$INSPECT_PORT"; then
    ui_pkg_log "Development inspect port: disabled"
  else
    ui_pkg_log "Development inspect port: $INSPECT_PORT"
  fi
  ui_pkg_log "Development runtime owner scope: checkout=$ROOT_DIR state-root=$DEVELOPMENT_STATE_ROOT"
  ui_pkg_log "The isolated profile does not copy providers, secrets, or databases. Configure a Provider in this development profile before using Flower."
}

ensure_desktop_workspace() {
  if [ ! -f "$DESKTOP_DIR/package.json" ]; then
    ui_pkg_die "desktop workspace not found: $DESKTOP_DIR"
  fi
  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js 26.x)"
  fi
}

ensure_desktop_dependencies() {
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  (
    cd "$DESKTOP_DIR"
    if ui_pkg_need_install "$DESKTOP_DIR" || ! node -e 'require.resolve("electron")' >/dev/null 2>&1; then
      ui_pkg_log "Installing Desktop dependencies before resolving Electron..."
      npm ci
    fi
  )
}

prepare_instance_bundle_snapshot() {
	local snapshots_root build_root working_bundle manifest_digest snapshot_root
	snapshots_root="$DEVELOPMENT_STATE_ROOT/desktop/bundles"
	mkdir -p "$snapshots_root"
	build_root="$(mktemp -d "$snapshots_root/.build.XXXXXX")"
	working_bundle="$build_root/bundle"
	if ! REDEVEN_DESKTOP_BUNDLE_OUTPUT_DIR="$working_bundle" \
		REDEVEN_DESKTOP_BUNDLE_PROVENANCE=development_bundle \
		npm run prepare:bundled-runtime
	then
		rm -rf "$build_root"
		return 1
	fi
	manifest_digest="$(shasum -a 256 "$working_bundle/desktop-bundle-manifest.json" | awk '{print $1}')"
	snapshot_root="$snapshots_root/$manifest_digest"
	if [ -e "$snapshot_root" ]; then
		if ! diff -qr "$working_bundle" "$snapshot_root" >/dev/null; then
			rm -rf "$build_root"
			ui_pkg_die "development bundle snapshot digest collision at $snapshot_root"
		fi
		rm -rf "$build_root"
	else
		mv "$working_bundle" "$snapshot_root"
		chmod -R a-w "$snapshot_root"
		rmdir "$build_root"
	fi
	DEVELOPMENT_BUNDLE_ROOT="$snapshot_root"
	export REDEVEN_DESKTOP_BUNDLED_RUNTIME_ROOT="$snapshot_root"
	ui_pkg_log "Development bundle snapshot: $snapshot_root"
	ui_pkg_log "Development bundle manifest SHA-256: $manifest_digest"
}

start_desktop() {
	local electron_binary cmd
  local ssh_runtime_release_tag
	electron_binary="$(cd "$DESKTOP_DIR" && node -e 'process.stdout.write(require("electron"))')"
	[ -x "$electron_binary" ] || ui_pkg_die "Electron executable is unavailable: $electron_binary"
	cmd=("$electron_binary")

  ui_pkg_log "Starting Redeven Desktop from the current checkout..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  ui_pkg_log "DESKTOP_DIR: $DESKTOP_DIR"
  ui_pkg_log "Env App Plugin UI: enabled for development"
  ssh_runtime_release_tag="$(resolve_ssh_runtime_release_tag)"
  if [ -n "$ssh_runtime_release_tag" ]; then
    ui_pkg_log "SSH runtime release tag: $ssh_runtime_release_tag"
  else
    ui_pkg_log "SSH runtime release tag: unset"
    ui_pkg_log "Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG to test SSH Host bootstrap."
  fi
  if is_enabled "$OPEN_DEVTOOLS"; then
    ui_pkg_log "DevTools: enabled"
  else
    ui_pkg_log "DevTools: disabled"
  fi
  if electron_args_include_switch "--remote-debugging-port"; then
    ui_pkg_log "CDP remote debugging: configured by explicit Electron args"
  elif debug_port_disabled "$REMOTE_DEBUGGING_PORT"; then
    ui_pkg_log "CDP remote debugging: disabled"
  else
    ui_pkg_log "CDP remote debugging: http://127.0.0.1:$REMOTE_DEBUGGING_PORT/json/version"
  fi
  if electron_args_include_inspect_switch; then
    ui_pkg_log "Main-process inspector: configured by explicit Electron args"
  elif debug_port_disabled "$INSPECT_PORT"; then
    ui_pkg_log "Main-process inspector: disabled"
  else
    ui_pkg_log "Main-process inspector: 127.0.0.1:$INSPECT_PORT"
  fi

  if [ "${#ELECTRON_DEBUG_ARGS[@]}" -gt 0 ]; then
    cmd+=("${ELECTRON_DEBUG_ARGS[@]}")
  fi
	cmd+=("--redeven-dev-instance=$DEVELOPMENT_INSTANCE_ID" .)
  if [ "${#ELECTRON_ARGS[@]}" -gt 0 ]; then
    cmd+=("${ELECTRON_ARGS[@]}")
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Would run in %q: npm run build\n' "$DESKTOP_DIR"
		printf 'Would build an immutable development bundle snapshot below %q\n' "$DEVELOPMENT_STATE_ROOT/desktop/bundles"
    printf 'Would run in %q: ' "$DESKTOP_DIR"
    print_command "${cmd[@]}"
    return 0
  fi

  (
    cd "$DESKTOP_DIR"
    export REDEVEN_DESKTOP_OPEN_DEVTOOLS="$OPEN_DEVTOOLS"
    export REDEVEN_DESKTOP_AUTO_START_RUNTIME="${REDEVEN_DESKTOP_AUTO_START_RUNTIME:-1}"
    export REDEVEN_STATE_ROOT="$DEVELOPMENT_STATE_ROOT"
    export REDEVEN_DESKTOP_LOCAL_UI_BIND="$LOCAL_UI_BIND"
    if [ -n "$ssh_runtime_release_tag" ]; then
      export REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG="$ssh_runtime_release_tag"
      export REDEVEN_DESKTOP_BUNDLE_VERSION="${REDEVEN_DESKTOP_BUNDLE_VERSION:-$ssh_runtime_release_tag}"
    fi
    export REDEVEN_DESKTOP_BUNDLE_COMMIT="${REDEVEN_DESKTOP_BUNDLE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
			export REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT="${REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT:-$ROOT_DIR}"
			npm run build
			prepare_instance_bundle_snapshot
			mkdir -p "$(dirname -- "$DEVELOPMENT_DESKTOP_PID_FILE")"
			exec env REDEVEN_DESKTOP_PID_FILE="$DEVELOPMENT_DESKTOP_PID_FILE" sh -c '
				set -eu
				pid_file=$REDEVEN_DESKTOP_PID_FILE
				temporary_pid_file="${pid_file}.tmp.$$"
				(umask 077; printf "%s\n" "$$" > "$temporary_pid_file")
				mv "$temporary_pid_file" "$pid_file"
				exec "$@"
			' redeven-dev-desktop "${cmd[@]}"
  )
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-devtools)
        OPEN_DEVTOOLS=0
        shift 1
        ;;
      --no-stop)
        STOP_EXISTING=0
        shift 1
        ;;
      --stop-only)
        STOP_ONLY=1
        shift 1
        ;;
      --stop-runtimes)
        STOP_RUNTIMES=1
        shift 1
        ;;
      --stop-timeout)
        if [ "$#" -lt 2 ]; then
          die_usage "--stop-timeout requires a value"
        fi
        STOP_TIMEOUT_SECONDS="$2"
        shift 2
        ;;
      --remote-debugging-port)
        if [ "$#" -lt 2 ]; then
          die_usage "--remote-debugging-port requires a value"
        fi
		REMOTE_DEBUGGING_PORT="$2"
		PORTS_EXPLICIT=1
        shift 2
        ;;
      --inspect-port)
        if [ "$#" -lt 2 ]; then
          die_usage "--inspect-port requires a value"
        fi
		INSPECT_PORT="$2"
		PORTS_EXPLICIT=1
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift 1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift 1
        ELECTRON_ARGS=("$@")
        break
        ;;
      *)
        ELECTRON_ARGS+=("$1")
        shift 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  ui_pkg_require_node_26 "$ROOT_DIR"
	resolve_development_state_root
	validate_stop_timeout
	stop_existing_processes
	allocate_development_ports
	validate_debug_port "--remote-debugging-port" "$REMOTE_DEBUGGING_PORT"
	validate_debug_port "--inspect-port" "$INSPECT_PORT"
	validate_local_ui_bind
	build_electron_debug_args
	log_development_configuration
  if [ "$STOP_ONLY" -eq 1 ]; then
    return 0
  fi
  verify_development_ports
  ensure_desktop_workspace
  ensure_desktop_dependencies
  start_desktop
}

main "$@"
