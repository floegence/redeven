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
    pnpm "$@"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return 0
  fi
  ui_pkg_die "pnpm not found (install pnpm, or install Node.js and use corepack)"
}

ui_pkg_need_install() {
  local dir="$1"

  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    return 0
  fi
  if [ ! -d "$dir/node_modules" ]; then
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
