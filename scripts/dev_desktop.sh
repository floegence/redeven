#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="$ROOT_DIR/desktop"

# shellcheck source=scripts/ui_package_common.sh
source "$SCRIPT_DIR/ui_package_common.sh"

OPEN_DEVTOOLS="${REDEVEN_DESKTOP_OPEN_DEVTOOLS:-1}"
STOP_EXISTING=1
STOP_ONLY=0
DRY_RUN=0
STOP_TIMEOUT_SECONDS="${REDEVEN_DESKTOP_STOP_TIMEOUT_SECONDS:-8}"
ELECTRON_ARGS=()
COLLECTED_PIDS=()

usage() {
  cat <<'USAGE'
Usage: ./scripts/dev_desktop.sh [options] [-- <electron-args>]

Build and start Redeven Desktop from this checkout/worktree. The bundled runtime
is built from the same uncommitted source tree before Electron starts.

Options:
  --no-devtools             Do not open Desktop DevTools automatically.
  --no-stop                 Skip stopping existing Redeven Desktop/runtime processes.
  --stop-only               Stop existing Redeven Desktop/runtime processes, then exit.
  --stop-timeout <seconds>  Seconds to wait before force-stopping processes (default: 8).
  --dry-run                 Print the stop/start actions without changing processes.
  -h, --help                Show this help.

Environment:
  REDEVEN_DESKTOP_OPEN_DEVTOOLS=0|1
  REDEVEN_DESKTOP_STOP_TIMEOUT_SECONDS=<seconds>
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

  for existing in "${COLLECTED_PIDS[@]}"; do
    if [ "$existing" = "$pid" ]; then
      return 0
    fi
  done
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
  collect_pids_by_pattern '(^|/)redeven([[:space:]]|$).*([[:space:]]|^)run([[:space:]]|$)'
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

  ui_pkg_log "Stopping any existing Redeven Desktop/runtime before launch..."
  request_macos_desktop_quit
  collect_desktop_pids
  terminate_collected_pids "Redeven Desktop"
  collect_runtime_pids
  terminate_collected_pids "Redeven runtime"
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
  local cmd=(npm run start)

  ui_pkg_log "Starting Redeven Desktop from the current checkout..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  ui_pkg_log "DESKTOP_DIR: $DESKTOP_DIR"
  if is_enabled "$OPEN_DEVTOOLS"; then
    ui_pkg_log "DevTools: enabled"
  else
    ui_pkg_log "DevTools: disabled"
  fi

  if [ "${#ELECTRON_ARGS[@]}" -gt 0 ]; then
    cmd+=(-- "${ELECTRON_ARGS[@]}")
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
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
      --stop-timeout)
        if [ "$#" -lt 2 ]; then
          die_usage "--stop-timeout requires a value"
        fi
        STOP_TIMEOUT_SECONDS="$2"
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
  stop_existing_processes
  if [ "$STOP_ONLY" -eq 1 ]; then
    return 0
  fi
  ensure_desktop_workspace
  start_desktop
}

main "$@"
