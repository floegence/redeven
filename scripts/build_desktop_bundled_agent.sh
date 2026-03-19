#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

infer_target_from_tarball() {
  local tarball_path="$1"
  local field="$2"
  local tarball_name

  tarball_name="$(basename -- "$tarball_path")"
  if [[ "$tarball_name" =~ ^redeven_([^_]+)_([^_]+)\.tar\.gz$ ]]; then
    case "$field" in
      goos)
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
        ;;
      goarch)
        printf '%s\n' "${BASH_REMATCH[2]}"
        return 0
        ;;
    esac
  fi

  return 1
}

resolve_target_goos() {
  local tarball_path="${1:-}"
  if [ -n "${REDEVEN_DESKTOP_BUNDLE_GOOS:-}" ]; then
    printf '%s\n' "${REDEVEN_DESKTOP_BUNDLE_GOOS}"
    return 0
  fi
  if [ -n "$tarball_path" ] && infer_target_from_tarball "$tarball_path" goos; then
    return 0
  fi
  if ! command -v go >/dev/null 2>&1; then
    ui_pkg_die "go not found (required to resolve desktop bundle GOOS)"
  fi
  go env GOOS
}

resolve_target_goarch() {
  local tarball_path="${1:-}"
  if [ -n "${REDEVEN_DESKTOP_BUNDLE_GOARCH:-}" ]; then
    printf '%s\n' "${REDEVEN_DESKTOP_BUNDLE_GOARCH}"
    return 0
  fi
  if [ -n "$tarball_path" ] && infer_target_from_tarball "$tarball_path" goarch; then
    return 0
  fi
  if ! command -v go >/dev/null 2>&1; then
    ui_pkg_die "go not found (required to resolve desktop bundle GOARCH)"
  fi
  go env GOARCH
}

resolve_binary_name() {
  local goos="$1"
  if [ "$goos" = "windows" ]; then
    printf 'redeven.exe\n'
    return 0
  fi
  printf 'redeven\n'
}

prepare_bundle_dir() {
  local bundle_dir="$1"
  rm -rf "$bundle_dir"
  mkdir -p "$bundle_dir"
}

bundle_from_tarball() {
  local tarball_path="$1"
  local bundle_dir="$2"

  if [ ! -f "$tarball_path" ]; then
    ui_pkg_die "desktop bundle tarball not found: $tarball_path"
  fi
  if ! command -v tar >/dev/null 2>&1; then
    ui_pkg_die "tar not found (required to unpack REDEVEN_DESKTOP_AGENT_TARBALL)"
  fi

  ui_pkg_log "Preparing desktop bundled agent from release tarball..."
  ui_pkg_log "TARBALL: $tarball_path"

  prepare_bundle_dir "$bundle_dir"
  tar -xzf "$tarball_path" -C "$bundle_dir"
}

bundle_from_source() {
  local goos="$1"
  local goarch="$2"
  local output_path="$3"

  if ! command -v go >/dev/null 2>&1; then
    ui_pkg_die "go not found (required to build the desktop bundled agent)"
  fi

  local version="${REDEVEN_DESKTOP_BUNDLE_VERSION:-${REDEVEN_DESKTOP_VERSION:-0.0.0-dev}}"
  local commit="${REDEVEN_DESKTOP_BUNDLE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
  local build_time="${REDEVEN_DESKTOP_BUNDLE_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

  ui_pkg_log "Building desktop bundled agent from the current repository..."
  ui_pkg_log "TARGET: ${goos}-${goarch}"
  ui_pkg_log "OUTPUT: $output_path"

  "$SCRIPT_DIR/build_assets.sh"

  (
    cd "$ROOT_DIR"
    GOOS="$goos" \
    GOARCH="$goarch" \
    CGO_ENABLED="${CGO_ENABLED:-0}" \
    go build \
      -trimpath \
      -ldflags "-s -w -X main.Version=${version} -X main.Commit=${commit} -X main.BuildTime=${build_time}" \
      -o "$output_path" \
      ./cmd/redeven
  )
}

main() {
  local goos goarch binary_name bundle_dir bundle_path tarball_path
  tarball_path="${REDEVEN_DESKTOP_AGENT_TARBALL:-}"
  goos="$(resolve_target_goos "$tarball_path")"
  goarch="$(resolve_target_goarch "$tarball_path")"
  binary_name="$(resolve_binary_name "$goos")"
  bundle_dir="$ROOT_DIR/desktop/.bundle/${goos}-${goarch}"
  bundle_path="$bundle_dir/$binary_name"

  ui_pkg_log "Preparing desktop bundled agent..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"

  if [ -n "$tarball_path" ]; then
    bundle_from_tarball "$tarball_path" "$bundle_dir"
  else
    prepare_bundle_dir "$bundle_dir"
    bundle_from_source "$goos" "$goarch" "$bundle_path"
  fi

  if [ ! -f "$bundle_path" ]; then
    ui_pkg_die "desktop bundled agent not found after preparation: $bundle_path"
  fi

  chmod +x "$bundle_path"
  ui_pkg_log "Desktop bundled agent ready: $bundle_path"
  printf '%s\n' "$bundle_path"
}

main "$@"
