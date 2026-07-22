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
  if [[ "$tarball_name" =~ ^redeven(-gateway)?_([^_]+)_([^_]+)\.tar\.gz$ ]]; then
    case "$field" in
      goos)
        printf '%s\n' "${BASH_REMATCH[2]}"
        return 0
        ;;
      goarch)
        printf '%s\n' "${BASH_REMATCH[3]}"
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

validate_target() {
  local goos="$1"
  local goarch="$2"
  case "${goos}/${goarch}" in
    darwin/amd64|darwin/arm64|linux/amd64|linux/arm64)
      ;;
    *)
      ui_pkg_die "unsupported desktop bundle target: ${goos}/${goarch}"
      ;;
  esac
}

assert_tarball_target() {
  local tarball_path="$1"
  local expected_goos="$2"
  local expected_goarch="$3"
  local label="$4"
  local actual_goos actual_goarch

  actual_goos=$(infer_target_from_tarball "$tarball_path" goos) || ui_pkg_die "$label filename has no target identity: $tarball_path"
  actual_goarch=$(infer_target_from_tarball "$tarball_path" goarch) || ui_pkg_die "$label filename has no target identity: $tarball_path"
  if [[ "$actual_goos/$actual_goarch" != "$expected_goos/$expected_goarch" ]]; then
    ui_pkg_die "$label target $actual_goos/$actual_goarch does not match requested target $expected_goos/$expected_goarch"
  fi
}

assert_go_binary_target() {
  local binary_path="$1"
  local expected_goos="$2"
  local expected_goarch="$3"
  local label="$4"
  local metadata actual_goos actual_goarch

  if ! command -v go >/dev/null 2>&1; then
    ui_pkg_die "go not found (required to verify $label target metadata)"
  fi
  metadata=$(go version -m "$binary_path") || ui_pkg_die "$label is not a verifiable Go binary: $binary_path"
  actual_goos=$(awk '$1 == "build" && $2 ~ /^GOOS=/ { sub(/^GOOS=/, "", $2); print $2 }' <<<"$metadata")
  actual_goarch=$(awk '$1 == "build" && $2 ~ /^GOARCH=/ { sub(/^GOARCH=/, "", $2); print $2 }' <<<"$metadata")
  if [[ "$actual_goos/$actual_goarch" != "$expected_goos/$expected_goarch" ]]; then
    ui_pkg_die "$label binary target $actual_goos/$actual_goarch does not match requested target $expected_goos/$expected_goarch"
  fi
}

bundle_from_tarball() {
  local tarball_path="$1"
  local bundle_dir="$2"
  local goos="$3"
  local allow_args=(
    --allow-file redeven
    --allow-file LICENSE
    --allow-file THIRD_PARTY_NOTICES.md
  )
  local max_files=3

  if [ ! -f "$tarball_path" ]; then
    ui_pkg_die "desktop bundle tarball not found: $tarball_path"
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    ui_pkg_die "python3 not found (required to inspect REDEVEN_DESKTOP_RUNTIME_TARBALL)"
  fi

  ui_pkg_log "Preparing desktop bundled runtime from release tarball..."
  ui_pkg_log "TARBALL: $tarball_path"

  if [[ "$goos" == "linux" ]]; then
    allow_args+=(
      --allow-file redevplugin-runtime
      --allow-file REDEVPLUGIN_THIRD_PARTY_NOTICES.md
      --allow-file REDEVPLUGIN_RUNTIME.spdx.json
      --allow-file redevplugin-runtime.provenance.json
      --allow-file redevplugin-runtime.sig
      --allow-file redevplugin-runtime.pem
      --allow-file .redevplugin-release-artifacts-verified.json
    )
    max_files=10
  fi
  "$SCRIPT_DIR/safe_extract_tar.py" \
    --archive "$tarball_path" \
    --dest "$bundle_dir" \
    "${allow_args[@]}" \
    --max-files "$max_files" \
    --max-total-bytes 268435456
}

assert_bundle_inventory() {
  local bundle_dir="$1"
  local from_archive="$2"
  local goos="$3"
  BUNDLE_DIR="$bundle_dir" FROM_ARCHIVE="$from_archive" BUNDLE_GOOS="$goos" node <<'NODE'
const { lstatSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const expected = [
  "redeven",
  "redeven-gateway",
];
if (process.env.BUNDLE_GOOS === "linux") expected.push(
  ".redevplugin-release-artifacts-verified.json",
  "REDEVPLUGIN_RUNTIME.spdx.json",
  "REDEVPLUGIN_THIRD_PARTY_NOTICES.md",
  "redevplugin-runtime",
  "redevplugin-runtime.pem",
  "redevplugin-runtime.provenance.json",
  "redevplugin-runtime.sig",
);
if (process.env.FROM_ARCHIVE === "1") expected.push("LICENSE", "THIRD_PARTY_NOTICES.md");
expected.sort();
const actual = readdirSync(process.env.BUNDLE_DIR).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  fail(`bundle inventory mismatch; got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
}
for (const name of actual) {
  const stat = lstatSync(join(process.env.BUNDLE_DIR, name));
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`bundle entry must be a regular file: ${name}`);
}
function fail(message) {
  console.error(`[desktop-bundle] ${message}`);
  process.exit(1);
}
NODE
}

bundle_gateway_from_tarball() {
  local tarball_path="$1"
  local bundle_dir="$2"
  local extract_parent extract_root

  if [ -z "$tarball_path" ]; then
    return 0
  fi
  if [ ! -f "$tarball_path" ]; then
    ui_pkg_die "desktop bundle Gateway tarball not found: $tarball_path"
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    ui_pkg_die "python3 not found (required to inspect REDEVEN_DESKTOP_GATEWAY_TARBALL)"
  fi

  ui_pkg_log "Preparing desktop bundled Gateway from release tarball..."
  ui_pkg_log "GATEWAY_TARBALL: $tarball_path"
  extract_parent=$(mktemp -d)
  extract_root="$extract_parent/gateway"
  if ! "$SCRIPT_DIR/safe_extract_tar.py" \
    --archive "$tarball_path" \
    --dest "$extract_root" \
    --allow-file redeven-gateway \
    --allow-file LICENSE \
    --allow-file THIRD_PARTY_NOTICES.md \
    --max-files 3 \
    --max-total-bytes 268435456
  then
    rm -rf "$extract_parent"
    ui_pkg_die "Gateway release archive failed controlled extraction"
  fi
  if ! cmp -s "$extract_root/LICENSE" "$bundle_dir/LICENSE" ||
     ! cmp -s "$extract_root/THIRD_PARTY_NOTICES.md" "$bundle_dir/THIRD_PARTY_NOTICES.md"; then
    rm -rf "$extract_parent"
    ui_pkg_die "Gateway release archive metadata does not match the runtime archive"
  fi
  install -m 0755 "$extract_root/redeven-gateway" "$bundle_dir/redeven-gateway"
  rm -rf "$extract_parent"
}

stage_redevplugin_runtime() {
  local bundle_dir="$1"
  local goos="$2"
  local goarch="$3"
  local tmpdir

  tmpdir="$(mktemp -d)"
  ui_pkg_log "Building the verified ReDevPlugin runtime from published source crates..."
  if ! "$SCRIPT_DIR/stage_redevplugin_release_artifacts.sh" \
    --dest-dir "$tmpdir/redevplugin-release" \
    --redeven-goos "$goos" \
    --redeven-goarch "$goarch" \
    --runtime-out "$bundle_dir/redevplugin-runtime"
  then
    rm -rf "$tmpdir"
    return 1
  fi
  rm -rf "$tmpdir"
}

build_go_command() {
  local goos="$1"
  local goarch="$2"
  local output_path="$3"
  local command_path="$4"
  local version="$5"
  local commit="$6"
  local build_time="$7"

  (
    cd "$ROOT_DIR"
    GOOS="$goos" \
    GOARCH="$goarch" \
    CGO_ENABLED="${CGO_ENABLED:-0}" \
    go build \
      -trimpath \
      -ldflags "-s -w -X main.Version=${version} -X main.Commit=${commit} -X main.BuildTime=${build_time}" \
      -o "$output_path" \
      "$command_path"
  )
}

bundle_from_source() {
  local goos="$1"
  local goarch="$2"
  local output_path="$3"
  local runtime_gateway_output_path="$4"

  if ! command -v go >/dev/null 2>&1; then
    ui_pkg_die "go not found (required to build the desktop bundled runtime)"
  fi

  local version="${REDEVEN_DESKTOP_BUNDLE_VERSION:-${REDEVEN_DESKTOP_VERSION:-0.0.0-dev}}"
  local commit="${REDEVEN_DESKTOP_BUNDLE_COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)}"
  local build_time="${REDEVEN_DESKTOP_BUNDLE_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

  ui_pkg_log "Building desktop bundled runtime from the current repository..."
  ui_pkg_log "TARGET: ${goos}-${goarch}"
  ui_pkg_log "OUTPUT: $output_path"
  ui_pkg_log "GATEWAY_OUTPUT: $runtime_gateway_output_path"

  "$SCRIPT_DIR/build_assets.sh"

  build_go_command "$goos" "$goarch" "$output_path" ./cmd/redeven "$version" "$commit" "$build_time"
  build_go_command "$goos" "$goarch" "$runtime_gateway_output_path" ./cmd/redeven-gateway "$version" "$commit" "$build_time"
}

main() {
  local goos goarch binary_name bundle_parent bundle_dir bundle_path gateway_bundle_path
  local staging_parent working_bundle working_bundle_path working_gateway_path
  local tarball_path gateway_tarball_path from_archive
  tarball_path="${REDEVEN_DESKTOP_RUNTIME_TARBALL:-${REDEVEN_DESKTOP_AGENT_TARBALL:-}}"
  gateway_tarball_path="${REDEVEN_DESKTOP_GATEWAY_TARBALL:-}"
  goos="$(resolve_target_goos "$tarball_path")"
  goarch="$(resolve_target_goarch "$tarball_path")"
  binary_name="$(resolve_binary_name "$goos")"
  bundle_parent="$ROOT_DIR/desktop/.bundle"
  bundle_dir="$bundle_parent/${goos}-${goarch}"
  bundle_path="$bundle_dir/$binary_name"
  gateway_bundle_path="$bundle_dir/redeven-gateway"

  ui_pkg_log "Preparing desktop bundled runtime..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  validate_target "$goos" "$goarch"
  mkdir -p "$bundle_parent"
  staging_parent=$(mktemp -d "$bundle_parent/.${goos}-${goarch}.stage.XXXXXX")
  working_bundle="$staging_parent/bundle"
  working_bundle_path="$working_bundle/$binary_name"
  working_gateway_path="$working_bundle/redeven-gateway"
  trap 'rm -rf "$staging_parent"' EXIT

  if [ -n "$tarball_path" ]; then
    from_archive=1
    assert_tarball_target "$tarball_path" "$goos" "$goarch" "Redeven runtime archive"
    assert_tarball_target "$gateway_tarball_path" "$goos" "$goarch" "Redeven Gateway archive"
    bundle_from_tarball "$tarball_path" "$working_bundle" "$goos"
    bundle_gateway_from_tarball "$gateway_tarball_path" "$working_bundle"
  else
    from_archive=0
    mkdir -p "$working_bundle"
    bundle_from_source "$goos" "$goarch" "$working_bundle_path" "$working_gateway_path"
    if [[ "$goos" == "linux" ]]; then
      stage_redevplugin_runtime "$working_bundle" "$goos" "$goarch"
    fi
  fi

  if [ ! -f "$working_bundle_path" ]; then
    ui_pkg_die "desktop bundled runtime not found after preparation: $working_bundle_path"
  fi
  if [ ! -f "$working_gateway_path" ]; then
    ui_pkg_die "desktop bundled Gateway not found after preparation: $working_gateway_path"
  fi

  assert_bundle_inventory "$working_bundle" "$from_archive" "$goos"
  assert_go_binary_target "$working_bundle_path" "$goos" "$goarch" "Redeven runtime"
  assert_go_binary_target "$working_gateway_path" "$goos" "$goarch" "Redeven Gateway"
  "$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" \
    --scan-root "$working_bundle" \
    --runtime-target "${goos}/${goarch}"

  chmod +x "$working_bundle_path"
  chmod +x "$working_gateway_path"
  "$SCRIPT_DIR/safe_extract_tar.py" --replace-dir "$working_bundle" --dest "$bundle_dir"
  rm -rf "$staging_parent"
  trap - EXIT
  ui_pkg_log "Desktop bundled runtime ready: $bundle_path"
  ui_pkg_log "Desktop bundled Gateway ready: $gateway_bundle_path"
  printf '%s\n' "$bundle_path"
}

main "$@"
