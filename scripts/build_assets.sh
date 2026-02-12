#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &> /dev/null && pwd)

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return 0
  fi
  die "pnpm not found (install pnpm, or install Node.js and use corepack)"
}

need_install() {
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

build_envapp_ui() {
  local dir="$ROOT_DIR/internal/envapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Env App UI: skipped (missing: $dir)"
    return 0
  fi

  log ""
  log "Env App UI: building..."
  (
    cd "$dir"
    # 清理 Vite 预打包缓存，确保 node_modules 中升级的依赖不会因缓存而使用旧版本
    rm -rf node_modules/.vite 2>/dev/null || true
    if need_install "$dir"; then
      run_pnpm install --frozen-lockfile
    fi
    run_pnpm build
  )
  log "Env App UI: done."
}

build_codeapp_ui() {
  local dir="$ROOT_DIR/internal/codeapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Code App UI: skipped (missing: $dir)"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    die "npm not found (install Node.js)"
  fi

  log ""
  log "Code App UI: building..."
  (
    cd "$dir"
    if need_install "$dir"; then
      npm ci
    fi
    npm run build
  )
  log "Code App UI: done."
}

main() {
  log "Building redeven embedded assets..."
  log "ROOT_DIR: $ROOT_DIR"
  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    log "REDEVEN_AGENT_FORCE_INSTALL=1 (dependency reinstall enabled)"
  fi

  build_envapp_ui
  build_codeapp_ui

  log ""
  log "All embedded assets built."
}

main "$@"
