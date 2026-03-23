#!/usr/bin/env bash

ui_pkg_log() {
  printf '%s\n' "$*"
}

ui_pkg_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

ui_pkg_run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    # pnpm refuses to recreate node_modules without a TTY unless CI is set.
    if [ "${1:-}" = "install" ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${CI:-}" ]; then
      CI=true pnpm "$@"
    else
      pnpm "$@"
    fi
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    if [ "${1:-}" = "install" ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${CI:-}" ]; then
      CI=true corepack pnpm "$@"
    else
      corepack pnpm "$@"
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
