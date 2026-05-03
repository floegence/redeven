#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="$ROOT_DIR/desktop"

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

usage() {
  cat <<'USAGE'
Usage: ./scripts/dev_desktop.sh [options] [-- <electron-args>]

Build and start Redeven Desktop from this checkout/worktree. The bundled runtime
is built from the same uncommitted source tree before Electron starts.

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

process_cwd() {
  local pid="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

cwd_looks_like_redeven_desktop() {
  local cwd="$1"
  case "$cwd" in
    "$DESKTOP_DIR"|*/redeven/desktop|*/redeven-feat-*/desktop)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

collect_pids_by_pattern_and_desktop_cwd() {
  local pattern="$1"
  local pid cwd

  if ! command -v pgrep >/dev/null 2>&1 || ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r pid; do
    case "$pid" in
      ''|*[!0-9]*)
        continue
        ;;
    esac
    cwd="$(process_cwd "$pid" || true)"
    if [ -n "$cwd" ] && cwd_looks_like_redeven_desktop "$cwd"; then
      add_pid "$pid"
    fi
  done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

request_macos_desktop_quit() {
  if [ "$(uname -s)" != "Darwin" ] || ! command -v osascript >/dev/null 2>&1; then
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    ui_pkg_log "Would ask macOS to quit Redeven Desktop if it is running."
    return 0
  fi

  osascript -e 'if application id "com.floegence.redeven.desktop" is running then tell application id "com.floegence.redeven.desktop" to quit' >/dev/null 2>&1 || true
  osascript -e 'if application "Redeven Desktop" is running then tell application "Redeven Desktop" to quit' >/dev/null 2>&1 || true
  sleep 1
}

collect_desktop_pids() {
  reset_collected_pids
  collect_pids_by_pattern 'Redeven Desktop(\.app|$|[[:space:]])'
  collect_pids_by_pattern 'com\.floegence\.redeven\.desktop'
  collect_pids_by_pattern_and_desktop_cwd 'Electron'
  collect_pids_by_pattern_and_desktop_cwd 'electron([[:space:]]|$)'
  collect_pids_by_pattern_and_desktop_cwd 'npm.*run.*start'
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
    ui_pkg_log "Skipping existing process shutdown."
    return 0
  fi

  ui_pkg_log "Stopping any existing Redeven Desktop process before launch..."
  request_macos_desktop_quit
  collect_desktop_pids
  terminate_collected_pids "Redeven Desktop"
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
  local ssh_runtime_release_tag

  ui_pkg_log "Starting Redeven Desktop from the current checkout..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  ui_pkg_log "DESKTOP_DIR: $DESKTOP_DIR"
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

  (
    cd "$DESKTOP_DIR"
    if ui_pkg_need_install "$DESKTOP_DIR"; then
      npm ci
    fi
    export REDEVEN_DESKTOP_OPEN_DEVTOOLS="$OPEN_DEVTOOLS"
    if [ -n "$ssh_runtime_release_tag" ]; then
      export REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG="$ssh_runtime_release_tag"
      export REDEVEN_DESKTOP_BUNDLE_VERSION="${REDEVEN_DESKTOP_BUNDLE_VERSION:-$ssh_runtime_release_tag}"
    fi
    export REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT="${REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT:-$ROOT_DIR}"
    npm run build
    npm run prepare:bundled-runtime
    exec "${cmd[@]}"
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
  build_electron_debug_args
  stop_existing_processes
  if [ "$STOP_ONLY" -eq 1 ]; then
    return 0
  fi
  ensure_desktop_workspace
  start_desktop
}

main "$@"
