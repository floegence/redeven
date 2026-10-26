#!/usr/bin/env bash

ui_pkg_log() {
  printf '%s\n' "$*"
}

ui_pkg_die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

ui_pkg_electron_binary() (
  cd -- "$1" || return 1
  # Electron can download lazily during require(), including inherited installer
  # output. Keep those diagnostics on stderr and return only its exported path.
  node -e 'require("node:fs").writeFileSync(3, require("electron"))' 3>&1 1>&2
)

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
      CI=true corepack pnpm "$@" || return $?
    else
      corepack pnpm "$@" || return $?
    fi
    return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    if [ "${1:-}" = "install" ] && { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${CI:-}" ]; then
      CI=true pnpm "$@" || return $?
    else
      pnpm "$@" || return $?
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

# One owner selects the manager from package.json, not compatibility lockfiles.
# Receipts bind successful installs to manifests, locks and toolchain versions.
ui_pkg_manager() {
  node -e 'const p=require(process.argv[1]); process.stdout.write(p.packageManager?.startsWith("pnpm@") ? "pnpm" : "npm")' "$1/package.json"
}

ui_pkg_install_identity() {
  local dir="$1" manager="$2" version
  if [ "$manager" = pnpm ]; then version=$(cd "$dir" && ui_pkg_run_pnpm --version) || return $?; else version=$(npm --version) || return $?; fi
  node -e '
    const fs=require("node:fs"), crypto=require("node:crypto"), path=require("node:path");
    const [dir, manager, version]=process.argv.slice(1);
    const hash=crypto.createHash("sha256");
    hash.update(JSON.stringify([1, manager, version, process.version, process.platform, process.arch,
      process.env.NODE_ENV || "", process.env.npm_config_omit || "", process.env.npm_config_ignore_scripts || ""]));
    for(const name of ["package.json", manager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json", ".npmrc"])
      hash.update(name+"\0"+(fs.existsSync(path.join(dir,name)) ? fs.readFileSync(path.join(dir,name)) : "missing"));
    process.stdout.write(hash.digest("hex"));
  ' "$dir" "$manager" "$version"
}

ui_pkg_need_install() {
  local dir="$1" broken_link manager identity receipt
  [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" != 1 ] || return 0
  [ -d "$dir/node_modules" ] || return 0
  if broken_link="$(ui_pkg_first_broken_node_modules_link "$dir")"; then
    ui_pkg_log "Dependency install looks stale (broken symlink: $broken_link)"
    return 0
  fi
  # Small launcher fixtures without a lockfile have no dependency install step.
  [ -f "$dir/pnpm-lock.yaml" ] || [ -f "$dir/package-lock.json" ] || return 1
  manager=$(ui_pkg_manager "$dir")
  receipt="$dir/node_modules/.redeven-install-v1"
  [ -f "$receipt" ] && [ ! -L "$receipt" ] || return 0
  if [ "$manager" = pnpm ]; then
    [ -f "$dir/node_modules/.modules.yaml" ] || return 0
  else
    [ -f "$dir/node_modules/.package-lock.json" ] || return 0
  fi
  identity=$(ui_pkg_install_identity "$dir" "$manager") || return 0
  [ "$(cat "$receipt")" != "$identity" ]
}

ui_pkg_ensure_dependencies() (
  local dir="$1" manager identity receipt
  ui_pkg_need_install "$dir" || exit 0
  manager=$(ui_pkg_manager "$dir")
  identity=$(ui_pkg_install_identity "$dir" "$manager")
  receipt="$dir/node_modules/.redeven-install-v1"
  rm -f "$receipt"
  cd "$dir"
  ui_pkg_log "Installing $manager dependencies: $dir"
  if [ "$manager" = pnpm ]; then
    ui_pkg_run_pnpm install --frozen-lockfile || return $?
  else
    npm ci --no-audit --no-fund || return $?
  fi
  [ "$(ui_pkg_install_identity "$dir" "$manager")" = "$identity" ] || ui_pkg_die "Dependency inputs changed during installation; rerun from a stable checkout."
  printf '%s\n' "$identity" > "$receipt.tmp.$$"
  mv "$receipt.tmp.$$" "$receipt"
)
