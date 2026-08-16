#!/usr/bin/env bash

ui_pkg_log() {
  printf '%s\n' "$*"
}

ui_pkg_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

ui_pkg_require_node_26() {
  local root_dir="${1:-${ROOT_DIR:-}}"
  local required_version
  local actual_version

  if [ -z "$root_dir" ] || [ ! -f "$root_dir/.node-version" ]; then
    ui_pkg_die "repository .node-version is required"
  fi
  required_version=$(tr -d '\r\n' < "$root_dir/.node-version")
  case "$required_version" in
    26.*) ;;
    *) ui_pkg_die "repository .node-version must select Node.js 26.x" ;;
  esac
  if ! command -v node >/dev/null 2>&1; then
    ui_pkg_die "node not found (install Node.js 26.x)"
  fi
  actual_version=$(node -p 'process.versions.node')
  if [ "${actual_version%%.*}" != "26" ]; then
    ui_pkg_die "Node.js 26.x is required; found v${actual_version}"
  fi
}

ui_pkg_run_pnpm() {
  ui_pkg_require_node_26 "${ROOT_DIR:?ROOT_DIR is required}"
  if command -v corepack >/dev/null 2>&1; then
    # pnpm refuses to recreate node_modules without a TTY unless CI is set.
    if [ "${1:-}" = "install" ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${CI:-}" ]; then
      CI=true corepack pnpm "$@"
    else
      corepack pnpm "$@"
    fi
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    if [ "${1:-}" = "install" ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${CI:-}" ]; then
      CI=true pnpm "$@"
    else
      pnpm "$@"
    fi
    return 0
  fi
  ui_pkg_die "pnpm not found (install pnpm, or install Node.js and use corepack)"
}

ui_pkg_first_broken_symlink_in_dir() {
  local dir="$1"
  local entry
  local restore_shopt

  if [ ! -d "$dir" ]; then
    return 1
  fi

  restore_shopt="$(shopt -p nullglob dotglob)"
  shopt -s nullglob dotglob

  for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
    if [ -L "$entry" ] && [ ! -e "$entry" ]; then
      printf '%s\n' "$entry"
      eval "$restore_shopt"
      return 0
    fi
  done

  eval "$restore_shopt"
  return 1
}

ui_pkg_first_broken_node_modules_link() {
  local dir="$1"
  local scope_dir
  local broken_link
  local restore_shopt

  broken_link="$(ui_pkg_first_broken_symlink_in_dir "$dir/node_modules")" && {
    printf '%s\n' "$broken_link"
    return 0
  }

  broken_link="$(ui_pkg_first_broken_symlink_in_dir "$dir/node_modules/.bin")" && {
    printf '%s\n' "$broken_link"
    return 0
  }

  restore_shopt="$(shopt -p nullglob)"
  shopt -s nullglob
  for scope_dir in "$dir/node_modules"/@*; do
    broken_link="$(ui_pkg_first_broken_symlink_in_dir "$scope_dir")" && {
      eval "$restore_shopt"
      printf '%s\n' "$broken_link"
      return 0
    }
  done
  eval "$restore_shopt"

  return 1
}

ui_pkg_need_install() {
  local dir="$1"
  local broken_link

  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    return 0
  fi
  if [ ! -d "$dir/node_modules" ]; then
    return 0
  fi
  if broken_link="$(ui_pkg_first_broken_node_modules_link "$dir")"; then
    ui_pkg_log "Dependency install looks stale (broken symlink: $broken_link)"
    return 0
  fi

  if [ -f "$dir/pnpm-lock.yaml" ]; then
    local marker="$dir/node_modules/.modules.yaml"
    if [ ! -f "$marker" ]; then
      return 0
    fi
    if [ "$dir/pnpm-lock.yaml" -nt "$marker" ]; then
      return 0
    fi
    if [ -f "$dir/package.json" ] && [ "$dir/package.json" -nt "$marker" ]; then
      return 0
    fi
    return 1
  fi

  if [ -f "$dir/package-lock.json" ]; then
    local marker="$dir/node_modules/.package-lock.json"
    if [ ! -f "$marker" ]; then
      return 0
    fi
    if ! cmp -s "$dir/package-lock.json" "$marker"; then
      return 0
    fi
    if [ -f "$dir/package.json" ] && [ "$dir/package.json" -nt "$marker" ]; then
      return 0
    fi
    return 1
  fi

  return 1
}
