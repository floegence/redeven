#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="$ROOT_DIR/desktop"
WORKTREE_GIT_DIR=$(git -C "$ROOT_DIR" rev-parse --absolute-git-dir)
DEV_DESKTOP_OWNER_RECORD="$WORKTREE_GIT_DIR/redeven-dev-desktop-owner"
DEV_DESKTOP_LAUNCH_BLOCK_RECORD="$WORKTREE_GIT_DIR/redeven-dev-desktop-launch-block"
DEV_DESKTOP_USER_DATA_DIR="$WORKTREE_GIT_DIR/redeven-dev-desktop-user-data"
DEV_DESKTOP_TRANSITION_LOCK="$WORKTREE_GIT_DIR/redeven-dev-desktop-transition.lock"
DEV_DESKTOP_OWNER_SWITCH="--redeven-dev-desktop-owner"

# shellcheck source=scripts/ui_package_common.sh
source "$SCRIPT_DIR/ui_package_common.sh"

OPEN_DEVTOOLS="${REDEVEN_DESKTOP_OPEN_DEVTOOLS:-1}"
REMOTE_DEBUGGING_PORT="${REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT:-9222}"
INSPECT_PORT="${REDEVEN_DESKTOP_INSPECT_PORT:-9230}"
STOP_EXISTING=1
STOP_ONLY=0
DRY_RUN=0
STOP_RUNTIMES=0
STOP_TIMEOUT_SECONDS="${REDEVEN_DESKTOP_STOP_TIMEOUT_SECONDS:-8}"
ELECTRON_ARGS=()
ELECTRON_DEBUG_ARGS=()
COLLECTED_PIDS=()
DESKTOP_OWNER_PID=""
DESKTOP_OWNER_MARKER=""
DESKTOP_LAUNCH_BLOCK_PID=""
DESKTOP_LAUNCH_BLOCK_MARKER=""
TRANSITION_LOCK_PID=""
TRANSITION_LOCK_MARKER=""
HELD_TRANSITION_PID=""
HELD_TRANSITION_MARKER=""
HELD_TRANSITION_CREATED=0
PENDING_DESKTOP_PID=""
PENDING_DESKTOP_MARKER=""

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
                            Electron Chrome DevTools Protocol port (default: 9222, 0 disables).
  --inspect-port <port|0>   Electron main-process inspector port (default: 9230, 0 disables).
  --dry-run                 Print the stop/start actions without changing processes.
  -h, --help                Show this help.

Environment:
  REDEVEN_DESKTOP_OPEN_DEVTOOLS=0|1
  REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT=<port|0>
  REDEVEN_DESKTOP_INSPECT_PORT=<port|0>
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

validate_reserved_electron_args() {
  if electron_args_include_switch "$DEV_DESKTOP_OWNER_SWITCH"; then
    die_usage "$DEV_DESKTOP_OWNER_SWITCH is reserved for Dev Desktop process ownership"
  fi
  if electron_args_include_switch "--user-data-dir"; then
    die_usage "--user-data-dir is managed per worktree by dev_desktop.sh"
  fi
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

collect_pids_by_pattern() {
  local pattern="$1"
  local pid

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r pid; do
    add_pid "$pid"
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

process_command_line() {
  local pid="$1"
  ps -ww -p "$pid" -o command= 2>/dev/null
}

send_signal() {
  local signal="$1"
  local pid="$2"
  kill "-$signal" "$pid" >/dev/null 2>&1
}

valid_desktop_owner_marker() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
}

valid_transition_marker() {
  [[ "$1" =~ ^[0-9]+-[0-9]+-[0-9]+$ ]]
}

load_transition_lock() {
  local pid_line marker_line extra_line

  TRANSITION_LOCK_PID=""
  TRANSITION_LOCK_MARKER=""
  [ -d "$DEV_DESKTOP_TRANSITION_LOCK" ] || return 1
  [ -f "$DEV_DESKTOP_TRANSITION_LOCK/owner" ] || return 2
  {
    IFS= read -r pid_line || return 2
    IFS= read -r marker_line || return 2
    if IFS= read -r extra_line; then
      return 2
    fi
  } <"$DEV_DESKTOP_TRANSITION_LOCK/owner"

  case "$pid_line" in
    pid=*) TRANSITION_LOCK_PID="${pid_line#pid=}" ;;
    *) return 2 ;;
  esac
  case "$TRANSITION_LOCK_PID" in
    ''|*[!0-9]*) return 2 ;;
  esac
  case "$marker_line" in
    marker=*) TRANSITION_LOCK_MARKER="${marker_line#marker=}" ;;
    *) return 2 ;;
  esac
  valid_transition_marker "$TRANSITION_LOCK_MARKER" || return 2
}

release_transition_lock_if_matches() {
  local expected_pid="$1"
  local expected_marker="$2"
  local stale_lock

  load_transition_lock || return 1
  [ "$TRANSITION_LOCK_PID" = "$expected_pid" ] || return 1
  [ "$TRANSITION_LOCK_MARKER" = "$expected_marker" ] || return 1
  stale_lock="${DEV_DESKTOP_TRANSITION_LOCK}.release.$$.${RANDOM}"
  mv -- "$DEV_DESKTOP_TRANSITION_LOCK" "$stale_lock" 2>/dev/null || return 1
  rm -rf -- "$stale_lock"
}

release_held_transition_lock() {
  local abandoned_lock released=0
  if [ -n "$HELD_TRANSITION_PID" ] && [ -n "$HELD_TRANSITION_MARKER" ]; then
    if load_transition_lock; then
      release_transition_lock_if_matches "$HELD_TRANSITION_PID" "$HELD_TRANSITION_MARKER" \
        || return 1
      released=1
    elif [ "$HELD_TRANSITION_CREATED" -eq 1 ] && [ -d "$DEV_DESKTOP_TRANSITION_LOCK" ]; then
      abandoned_lock="${DEV_DESKTOP_TRANSITION_LOCK}.abandoned.$$.${RANDOM}"
      if mv -- "$DEV_DESKTOP_TRANSITION_LOCK" "$abandoned_lock" 2>/dev/null; then
        rm -rf -- "$abandoned_lock"
        released=1
      fi
    elif [ ! -e "$DEV_DESKTOP_TRANSITION_LOCK" ]; then
      released=1
    fi
    if [ "$released" -ne 1 ]; then
      ui_pkg_log "[ERROR] failed to release the owned Dev Desktop transition lock."
      return 1
    fi
    HELD_TRANSITION_PID=""
    HELD_TRANSITION_MARKER=""
    HELD_TRANSITION_CREATED=0
  fi
}

owned_child_exited_or_zombie() {
  local pid="$1"
  local process_state

  pid_exists "$pid" || return 0
  process_state="$(ps -ww -p "$pid" -o state= 2>/dev/null || true)"
  case "$process_state" in
    *Z*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_owned_child_settlement() {
  local pid="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))

  while [ "$SECONDS" -lt "$deadline" ]; do
    owned_child_exited_or_zombie "$pid" && return 0
    sleep 0.05
  done
  owned_child_exited_or_zombie "$pid"
}

terminate_pending_desktop_child() {
  local pid marker

  pid="$PENDING_DESKTOP_PID"
  marker="$PENDING_DESKTOP_MARKER"
  [ -n "$pid" ] || return 0

  if pid_exists "$pid"; then
    if [ -z "$marker" ] || ! desktop_process_matches_owner "$pid" "$marker"; then
      if ! write_desktop_launch_block_record "$pid" "$marker"; then
        ui_pkg_log "[ERROR] failed to preserve the unresolved Dev Desktop launch identity."
        return 1
      fi
      ui_pkg_log "[ERROR] unpublished Dev Desktop child PID $pid no longer matches its launch marker; refusing TERM."
      return 1
    fi
    if ! write_desktop_owner_record "$pid" "$marker"; then
      if ! write_desktop_launch_block_record "$pid" "$marker"; then
        ui_pkg_log "[ERROR] failed to preserve the verified Dev Desktop launch identity."
        return 1
      fi
      ui_pkg_log "[ERROR] failed to preserve pending Dev Desktop ownership before TERM."
      return 1
    fi
    remove_desktop_launch_block_record_if_matches "$pid" "$marker"
    if ! send_signal TERM "$pid"; then
      if ! pid_exists "$pid"; then
        wait "$pid" 2>/dev/null || true
        remove_desktop_owner_record_if_matches "$pid" "$marker"
        PENDING_DESKTOP_PID=""
        PENDING_DESKTOP_MARKER=""
        return 0
      fi
      ui_pkg_log "[ERROR] failed to send TERM to unpublished Dev Desktop child PID $pid."
      return 1
    fi
    wait_for_owned_child_settlement "$pid" 2 || true
  fi
  if ! owned_child_exited_or_zombie "$pid"; then
    if [ -z "$marker" ] || ! desktop_process_matches_owner "$pid" "$marker"; then
      if ! write_desktop_launch_block_record "$pid" "$marker"; then
        ui_pkg_log "[ERROR] failed to preserve the changed Dev Desktop launch identity."
        return 1
      fi
      ui_pkg_log "[ERROR] unpublished Dev Desktop child PID $pid changed identity; refusing KILL."
      return 1
    fi
    if ! send_signal KILL "$pid"; then
      ui_pkg_log "[ERROR] failed to send KILL to unpublished Dev Desktop child PID $pid."
      return 1
    fi
  fi
  if ! wait_for_owned_child_settlement "$pid" 2; then
    if pid_exists "$pid" && ! desktop_process_matches_owner "$pid" "$marker"; then
      if ! write_desktop_launch_block_record "$pid" "$marker"; then
        ui_pkg_log "[ERROR] failed to preserve the unsettled Dev Desktop launch identity."
        return 1
      fi
    fi
    ui_pkg_log "[ERROR] unpublished Dev Desktop child PID $pid remained alive after KILL."
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  if [ -n "$marker" ]; then
    remove_desktop_owner_record_if_matches "$pid" "$marker"
    remove_desktop_launch_block_record_if_matches "$pid" "$marker"
  fi
  PENDING_DESKTOP_PID=""
  PENDING_DESKTOP_MARKER=""
}

handle_script_exit() {
  local status=$?

  trap - EXIT INT TERM
  if ! terminate_pending_desktop_child && [ "$status" -eq 0 ]; then
    status=1
  fi
  if ! release_held_transition_lock && [ "$status" -eq 0 ]; then
    status=1
  fi
  exit "$status"
}

acquire_transition_lock() {
  local stale_lock attempt

  HELD_TRANSITION_PID="$$"
  HELD_TRANSITION_MARKER="$$-${RANDOM}-$(date +%s)"
  for attempt in 1 2 3; do
    if mkdir -m 700 -- "$DEV_DESKTOP_TRANSITION_LOCK" 2>/dev/null; then
      HELD_TRANSITION_CREATED=1
      (
        umask 077
        printf 'pid=%s\nmarker=%s\n' "$HELD_TRANSITION_PID" "$HELD_TRANSITION_MARKER" \
          >"$DEV_DESKTOP_TRANSITION_LOCK/owner"
      )
      trap handle_script_exit EXIT
      trap 'exit 130' INT
      trap 'exit 143' TERM
      return 0
    fi

    if load_transition_lock && pid_exists "$TRANSITION_LOCK_PID"; then
      ui_pkg_die "another Dev Desktop transition is active for this worktree"
    fi
    if ! load_transition_lock; then
      if [ "$attempt" -lt 3 ]; then
        sleep 0.1
        continue
      fi
      ui_pkg_die "Dev Desktop transition lock is incomplete; remove it only after verifying no transition is active"
    fi

    stale_lock="${DEV_DESKTOP_TRANSITION_LOCK}.stale.$$.${RANDOM}"
    if mv -- "$DEV_DESKTOP_TRANSITION_LOCK" "$stale_lock" 2>/dev/null; then
      rm -rf -- "$stale_lock"
    fi
  done
  ui_pkg_die "could not acquire the Dev Desktop transition lock"
}

load_desktop_owner_record() {
  local schema_line pid_line marker_line extra_line

  DESKTOP_OWNER_PID=""
  DESKTOP_OWNER_MARKER=""
  [ -f "$DEV_DESKTOP_OWNER_RECORD" ] || return 1
  {
    IFS= read -r schema_line || return 2
    IFS= read -r pid_line || return 2
    IFS= read -r marker_line || return 2
    if IFS= read -r extra_line; then
      return 2
    fi
  } <"$DEV_DESKTOP_OWNER_RECORD"

  [ "$schema_line" = "schema=1" ] || return 2
  case "$pid_line" in
    pid=*) DESKTOP_OWNER_PID="${pid_line#pid=}" ;;
    *) return 2 ;;
  esac
  case "$DESKTOP_OWNER_PID" in
    ''|*[!0-9]*) return 2 ;;
  esac
  case "$marker_line" in
    marker=*) DESKTOP_OWNER_MARKER="${marker_line#marker=}" ;;
    *) return 2 ;;
  esac
  valid_desktop_owner_marker "$DESKTOP_OWNER_MARKER" || return 2
}

load_desktop_launch_block_record() {
  local schema_line pid_line marker_line extra_line

  DESKTOP_LAUNCH_BLOCK_PID=""
  DESKTOP_LAUNCH_BLOCK_MARKER=""
  [ -f "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD" ] || return 1
  {
    IFS= read -r schema_line || return 2
    IFS= read -r pid_line || return 2
    IFS= read -r marker_line || return 2
    if IFS= read -r extra_line; then
      return 2
    fi
  } <"$DEV_DESKTOP_LAUNCH_BLOCK_RECORD"

  [ "$schema_line" = "schema=1" ] || return 2
  case "$pid_line" in
    pid=*) DESKTOP_LAUNCH_BLOCK_PID="${pid_line#pid=}" ;;
    *) return 2 ;;
  esac
  case "$DESKTOP_LAUNCH_BLOCK_PID" in
    ''|*[!0-9]*) return 2 ;;
  esac
  case "$marker_line" in
    marker=*) DESKTOP_LAUNCH_BLOCK_MARKER="${marker_line#marker=}" ;;
    *) return 2 ;;
  esac
  valid_desktop_owner_marker "$DESKTOP_LAUNCH_BLOCK_MARKER" || return 2
}

desktop_process_matches_owner() {
  local pid="$1"
  local marker="$2"
  local command_line

  pid_exists "$pid" || return 1
  command_line="$(process_command_line "$pid" || true)"
  case " $command_line " in
    *" $DEV_DESKTOP_OWNER_SWITCH=$marker "*) return 0 ;;
    *) return 1 ;;
  esac
}

remove_desktop_owner_record_if_matches() {
  local expected_pid="$1"
  local expected_marker="$2"

  if load_desktop_owner_record \
    && [ "$DESKTOP_OWNER_PID" = "$expected_pid" ] \
    && [ "$DESKTOP_OWNER_MARKER" = "$expected_marker" ]; then
    rm -f -- "$DEV_DESKTOP_OWNER_RECORD"
  fi
}

write_desktop_owner_record() {
  local pid="$1"
  local marker="$2"
  local temp_record="${DEV_DESKTOP_OWNER_RECORD}.tmp.$$"

  if ! (
    umask 077
    mkdir -p -- "$(dirname -- "$DEV_DESKTOP_OWNER_RECORD")" "$DEV_DESKTOP_USER_DATA_DIR" \
      && chmod 700 "$DEV_DESKTOP_USER_DATA_DIR" \
      && printf 'schema=1\npid=%s\nmarker=%s\n' "$pid" "$marker" >"$temp_record"
  ); then
    rm -f -- "$temp_record"
    return 1
  fi
  if ! mv -f -- "$temp_record" "$DEV_DESKTOP_OWNER_RECORD"; then
    rm -f -- "$temp_record"
    return 1
  fi
}

write_desktop_launch_block_record() {
  local pid="$1"
  local marker="$2"
  local temp_record="${DEV_DESKTOP_LAUNCH_BLOCK_RECORD}.tmp.$$"

  valid_desktop_owner_marker "$marker" || return 1
  if ! (
    umask 077
    mkdir -p -- "$(dirname -- "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD")" \
      && printf 'schema=1\npid=%s\nmarker=%s\n' "$pid" "$marker" >"$temp_record"
  ); then
    rm -f -- "$temp_record"
    return 1
  fi
  if ! mv -f -- "$temp_record" "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD"; then
    rm -f -- "$temp_record"
    return 1
  fi
}

remove_desktop_launch_block_record_if_matches() {
  local expected_pid="$1"
  local expected_marker="$2"

  if load_desktop_launch_block_record \
    && [ "$DESKTOP_LAUNCH_BLOCK_PID" = "$expected_pid" ] \
    && [ "$DESKTOP_LAUNCH_BLOCK_MARKER" = "$expected_marker" ]; then
    rm -f -- "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD"
  fi
}

reconcile_desktop_launch_block() {
  local pid marker

  if ! load_desktop_launch_block_record; then
    if [ -e "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD" ]; then
      ui_pkg_die "invalid Dev Desktop launch block requires manual verification"
    fi
    return 0
  fi
  pid="$DESKTOP_LAUNCH_BLOCK_PID"
  marker="$DESKTOP_LAUNCH_BLOCK_MARKER"
  if ! pid_exists "$pid"; then
    remove_desktop_launch_block_record_if_matches "$pid" "$marker"
    return 0
  fi
  if desktop_process_matches_owner "$pid" "$marker"; then
    if ! write_desktop_owner_record "$pid" "$marker"; then
      ui_pkg_die "failed to recover verified Dev Desktop launch ownership"
    fi
    remove_desktop_launch_block_record_if_matches "$pid" "$marker"
    return 0
  fi
  ui_pkg_die "an unresolved Dev Desktop launch identity blocks this worktree"
}

generate_desktop_owner_marker() {
  node -e "process.stdout.write(require('node:crypto').randomUUID())"
}

wait_for_desktop_launch_identity() {
  local pid="$1"
  local marker="$2"
  local attempt

  attempt=0
  while [ "$attempt" -lt 100 ]; do
    if desktop_process_matches_owner "$pid" "$marker"; then
      return 0
    fi
    pid_exists "$pid" || return 1
    sleep 0.02
    attempt=$((attempt + 1))
  done
  return 1
}

stop_owned_dev_desktop() {
  local pid marker deadline

  if ! load_desktop_owner_record; then
    if [ -e "$DEV_DESKTOP_OWNER_RECORD" ]; then
      ui_pkg_log "Removing invalid Dev Desktop owner record."
      rm -f -- "$DEV_DESKTOP_OWNER_RECORD"
    else
      ui_pkg_log "No Dev Desktop owned by this worktree is recorded."
    fi
    return 0
  fi

  pid="$DESKTOP_OWNER_PID"
  marker="$DESKTOP_OWNER_MARKER"
  if ! desktop_process_matches_owner "$pid" "$marker"; then
    ui_pkg_log "Removing stale Dev Desktop owner record without signaling PID $pid."
    remove_desktop_owner_record_if_matches "$pid" "$marker"
    return 0
  fi

  ui_pkg_log "Stopping Dev Desktop owned by this worktree: $pid"
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi

  # IMPORTANT: Dev Desktop stop authority comes only from this worktree's exact
  # validated launch record; never fall back to process discovery.
  if ! send_signal TERM "$pid"; then
    if ! pid_exists "$pid"; then
      remove_desktop_owner_record_if_matches "$pid" "$marker"
      return 0
    fi
    ui_pkg_log "[ERROR] failed to send TERM to owned Dev Desktop PID $pid."
    return 1
  fi
  deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! pid_exists "$pid"; then
      remove_desktop_owner_record_if_matches "$pid" "$marker"
      return 0
    fi
    if ! desktop_process_matches_owner "$pid" "$marker"; then
      ui_pkg_log "Dev Desktop ownership changed after TERM; refusing another signal to PID $pid."
      remove_desktop_owner_record_if_matches "$pid" "$marker"
      return 0
    fi
    sleep 0.2
  done

  if ! pid_exists "$pid"; then
    remove_desktop_owner_record_if_matches "$pid" "$marker"
    return 0
  fi
  if ! desktop_process_matches_owner "$pid" "$marker"; then
    ui_pkg_log "Dev Desktop ownership changed before KILL; refusing another signal to PID $pid."
    remove_desktop_owner_record_if_matches "$pid" "$marker"
    return 0
  fi
  ui_pkg_log "Force-stopping Dev Desktop owned by this worktree: $pid"
  if ! send_signal KILL "$pid"; then
    if ! pid_exists "$pid"; then
      remove_desktop_owner_record_if_matches "$pid" "$marker"
      return 0
    fi
    ui_pkg_log "[ERROR] failed to send KILL to owned Dev Desktop PID $pid."
    return 1
  fi
  if ! pid_exists "$pid"; then
    remove_desktop_owner_record_if_matches "$pid" "$marker"
    return 0
  fi
  if desktop_process_matches_owner "$pid" "$marker"; then
    ui_pkg_log "[ERROR] Dev Desktop PID $pid remained alive after KILL."
    return 1
  fi
  ui_pkg_log "[ERROR] Dev Desktop PID $pid changed identity after KILL; owner record was preserved."
  return 1
}

prepare_owner_state_without_stop() {
  local pid marker

  if ! load_desktop_owner_record; then
    if [ -e "$DEV_DESKTOP_OWNER_RECORD" ]; then
      ui_pkg_log "[ERROR] invalid Dev Desktop owner record blocks --no-stop launch."
      return 1
    fi
    return 0
  fi
  pid="$DESKTOP_OWNER_PID"
  marker="$DESKTOP_OWNER_MARKER"
  if desktop_process_matches_owner "$pid" "$marker"; then
    ui_pkg_log "[ERROR] --no-stop cannot replace the live Dev Desktop owned by this worktree."
    return 1
  fi
  remove_desktop_owner_record_if_matches "$pid" "$marker"
}

collect_runtime_pids() {
  reset_collected_pids
  collect_pids_by_pattern 'redeven[[:space:]]run[[:space:]]'
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
    ui_pkg_log "Skipping process shutdown after verifying this worktree has no live owner."
    prepare_owner_state_without_stop
    return
  fi

  ui_pkg_log "Stopping the Dev Desktop process owned by this worktree before launch..."
  stop_owned_dev_desktop
  if [ "$STOP_RUNTIMES" -eq 1 ]; then
    ui_pkg_log "Stopping Redeven runtime processes because --stop-runtimes was provided. This can interrupt active work."
    collect_runtime_pids
    terminate_collected_pids "Redeven runtime"
  else
    ui_pkg_log "Leaving existing Redeven runtime processes running."
  fi
}

ensure_desktop_workspace() {
  if [ ! -f "$DESKTOP_DIR/package.json" ]; then
    ui_pkg_die "desktop workspace not found: $DESKTOP_DIR"
  fi
  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js 24+)"
  fi
}

start_desktop() {
  local cmd=("./node_modules/.bin/electron")
  local desktop_pid desktop_status
  local electron_binary
  local ssh_runtime_release_tag
  local launch_marker

  ui_pkg_log "Starting Redeven Desktop from the current checkout..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  ui_pkg_log "DESKTOP_DIR: $DESKTOP_DIR"
  ui_pkg_log "Env App Plugin UI: enabled for development"
  ssh_runtime_release_tag="$(resolve_ssh_runtime_release_tag)"
  launch_marker="$(generate_desktop_owner_marker)"
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
  cmd+=("--user-data-dir=$DEV_DESKTOP_USER_DATA_DIR")
  cmd+=("$DEV_DESKTOP_OWNER_SWITCH=$launch_marker")
  cmd+=(.)
  if [ "${#ELECTRON_ARGS[@]}" -gt 0 ]; then
    cmd+=("${ELECTRON_ARGS[@]}")
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Would run in %q: npm run build\n' "$DESKTOP_DIR"
    printf 'Would run in %q: npm run prepare:bundled-runtime\n' "$DESKTOP_DIR"
    printf 'Would run in %q: ' "$DESKTOP_DIR"
    print_command "${cmd[@]}"
    return 0
  fi

  cd "$DESKTOP_DIR"
  if ui_pkg_need_install "$DESKTOP_DIR"; then
    npm ci
  fi
  export REDEVEN_DESKTOP_OPEN_DEVTOOLS="$OPEN_DEVTOOLS"
  if [ -n "$ssh_runtime_release_tag" ]; then
    export REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG="$ssh_runtime_release_tag"
    export REDEVEN_DESKTOP_BUNDLE_VERSION="${REDEVEN_DESKTOP_BUNDLE_VERSION:-$ssh_runtime_release_tag}"
  fi
  export REDEVEN_DESKTOP_BUNDLE_COMMIT="${REDEVEN_DESKTOP_BUNDLE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
  export REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT="${REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT:-$ROOT_DIR}"
  npm run build
  npm run prepare:bundled-runtime
  electron_binary="$(node -p "require('electron')")"
  cmd[0]="$electron_binary"
  "${cmd[@]}" &
  desktop_pid=$!
  PENDING_DESKTOP_PID="$desktop_pid"
  PENDING_DESKTOP_MARKER="$launch_marker"
  if ! wait_for_desktop_launch_identity "$desktop_pid" "$launch_marker"; then
    ui_pkg_die "Dev Desktop exited before its launch identity could be verified"
  fi
  if ! write_desktop_owner_record "$desktop_pid" "$launch_marker"; then
    if ! write_desktop_launch_block_record "$desktop_pid" "$launch_marker"; then
      ui_pkg_die "failed to preserve the verified Dev Desktop launch identity"
    fi
    ui_pkg_die "failed to publish Dev Desktop ownership"
  fi
  remove_desktop_launch_block_record_if_matches "$desktop_pid" "$launch_marker"
  if ! release_held_transition_lock; then
    ui_pkg_die "failed to release the Dev Desktop transition lock after publishing ownership"
  fi
  PENDING_DESKTOP_PID=""
  PENDING_DESKTOP_MARKER=""
  if wait "$desktop_pid"; then
    desktop_status=0
  else
    desktop_status=$?
  fi
  return "$desktop_status"
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
        shift 2
        ;;
      --inspect-port)
        if [ "$#" -lt 2 ]; then
          die_usage "--inspect-port requires a value"
        fi
        INSPECT_PORT="$2"
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
  validate_stop_timeout
  validate_debug_port "--remote-debugging-port" "$REMOTE_DEBUGGING_PORT"
  validate_debug_port "--inspect-port" "$INSPECT_PORT"
  validate_reserved_electron_args
  build_electron_debug_args
  acquire_transition_lock
  reconcile_desktop_launch_block
  stop_existing_processes
  if [ "$STOP_ONLY" -eq 1 ]; then
    return 0
  fi
  ensure_desktop_workspace
  start_desktop
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
