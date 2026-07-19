#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/check_desktop_redevplugin_package.sh --package <file> --runtime-target <goos/arch> --write-receipt <file>

Inspects a native Redeven Desktop installer on its builder platform, verifies
the embedded Redeven, Gateway, and ReDevPlugin runtime target identities, and
writes a receipt bound to the exact installer bytes.
USAGE
}

PACKAGE_PATH=""
RUNTIME_TARGET=""
RECEIPT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package)
      PACKAGE_PATH="${2:-}"
      shift 2
      ;;
    --runtime-target)
      RUNTIME_TARGET="${2:-}"
      shift 2
      ;;
    --write-receipt)
      RECEIPT_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unexpected argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

die() {
  echo "[desktop-redevplugin-package] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{ print $1 }'
  else
    shasum -a 256 "$path" | awk '{ print $1 }'
  fi
}

assert_package_target() {
  local name="$1"
  local expected="$2"
  local actual=""
  case "$name" in
    Redeven-Desktop-*-linux-x64.deb|Redeven-Desktop-*-linux-x64.rpm)
      actual="linux/amd64"
      ;;
    Redeven-Desktop-*-linux-arm64.deb|Redeven-Desktop-*-linux-arm64.rpm)
      actual="linux/arm64"
      ;;
    Redeven-Desktop-*-mac-x64.dmg)
      actual="darwin/amd64"
      ;;
    Redeven-Desktop-*-mac-arm64.dmg)
      actual="darwin/arm64"
      ;;
    *)
      die "installer filename has no closed target identity: $name"
      ;;
  esac
  [[ "$actual" == "$expected" ]] || die "installer target $actual does not match expected target $expected"
}

assert_linux_package_metadata() {
  local package_path="$1"
  local format="$2"
  local expected_target="$3"
  local actual_arch installed_bytes expected_arch
  case "$format:$expected_target" in
    deb:linux/amd64) expected_arch="amd64" ;;
    deb:linux/arm64) expected_arch="arm64" ;;
    rpm:linux/amd64) expected_arch="x86_64" ;;
    rpm:linux/arm64) expected_arch="aarch64" ;;
    *) die "package format and runtime target do not match" ;;
  esac
  if [[ "$format" == "deb" ]]; then
    actual_arch=$(dpkg-deb -f "$package_path" Architecture)
    installed_bytes=$(( $(dpkg-deb -f "$package_path" Installed-Size) * 1024 ))
  else
    require_command rpm
    actual_arch=$(rpm -qp --qf '%{ARCH}' "$package_path")
    installed_bytes=$(rpm -qp --qf '%{SIZE}' "$package_path")
  fi
  [[ "$actual_arch" == "$expected_arch" ]] ||
    die "$format architecture $actual_arch does not match $expected_arch"
  [[ "$installed_bytes" =~ ^[0-9]+$ && "$installed_bytes" -gt 0 && "$installed_bytes" -le 2147483648 ]] ||
    die "$format expanded size is outside the closed 2 GiB limit"
}

assert_go_binary_target() {
  local path="$1"
  local expected_goos="$2"
  local expected_goarch="$3"
  local label="$4"
  local metadata actual_goos actual_goarch

  metadata=$(go version -m "$path") || die "$label is not a verifiable Go binary"
  actual_goos=$(awk '$1 == "build" && $2 ~ /^GOOS=/ { sub(/^GOOS=/, "", $2); print $2 }' <<<"$metadata")
  actual_goarch=$(awk '$1 == "build" && $2 ~ /^GOARCH=/ { sub(/^GOARCH=/, "", $2); print $2 }' <<<"$metadata")
  [[ "$actual_goos/$actual_goarch" == "$expected_goos/$expected_goarch" ]] ||
    die "$label target $actual_goos/$actual_goarch does not match $expected_goos/$expected_goarch"
}

publish_receipt() {
  local package_path="$1"
  local package_name="$2"
  local runtime_path="$3"
  local marker_path="$4"
  local notices_path="$5"
  local receipt_path="$6"
  local receipt_dir receipt_name temporary

  receipt_dir=$(dirname -- "$receipt_path")
  receipt_name=$(basename -- "$receipt_path")
  mkdir -p "$receipt_dir"
  receipt_dir=$(cd -- "$receipt_dir" >/dev/null 2>&1 && pwd -P)
  [[ ! -L "$receipt_dir/$receipt_name" && ! -d "$receipt_dir/$receipt_name" ]] ||
    die "receipt destination must be a regular file path"
  temporary=$(mktemp "$receipt_dir/.${receipt_name}.publish.XXXXXX")
  PACKAGE_NAME="$package_name" \
    PACKAGE_SHA256=$(hash_file "$package_path") \
    PACKAGE_SIZE=$(wc -c <"$package_path" | tr -d ' ') \
    RUNTIME_TARGET="$RUNTIME_TARGET" \
    RUNTIME_SHA256=$(hash_file "$runtime_path") \
    RUNTIME_SIZE=$(wc -c <"$runtime_path" | tr -d ' ') \
    MARKER_SHA256=$(hash_file "$marker_path") \
    NOTICES_SHA256=$(hash_file "$notices_path") \
    RECEIPT_OUT="$temporary" \
    node <<'NODE'
const { writeFileSync } = require("node:fs");
const integer = (name) => {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
};
writeFileSync(process.env.RECEIPT_OUT, `${JSON.stringify({
  schema_version: "redeven.desktop_redevplugin_package_verification.v1",
  package: {
    name: process.env.PACKAGE_NAME,
    sha256: process.env.PACKAGE_SHA256,
    size: integer("PACKAGE_SIZE"),
  },
  runtime_target: process.env.RUNTIME_TARGET,
  redevplugin_runtime: {
    sha256: process.env.RUNTIME_SHA256,
    size: integer("RUNTIME_SIZE"),
  },
  marker_sha256: process.env.MARKER_SHA256,
  notices_sha256: process.env.NOTICES_SHA256,
}, null, 2)}\n`);
NODE
  chmod 0644 "$temporary"
  "$SCRIPT_DIR/safe_extract_tar.py" \
    --replace-file "$temporary" \
    --dest "$receipt_dir/$receipt_name"
}

[[ -n "$PACKAGE_PATH" && -f "$PACKAGE_PATH" && -n "$RUNTIME_TARGET" && -n "$RECEIPT_PATH" ]] || {
  usage >&2
  exit 2
}
original_package_path="$PACKAGE_PATH"
package_name=$(basename -- "$original_package_path")
case "$RUNTIME_TARGET" in
  darwin/amd64|darwin/arm64|linux/amd64|linux/arm64)
    ;;
  *)
    die "unsupported runtime target: $RUNTIME_TARGET"
    ;;
esac

require_command go
require_command node
assert_package_target "$package_name" "$RUNTIME_TARGET"

extract_root=$(mktemp -d)
mounted=0
cleanup() {
  if [[ "$mounted" -eq 1 ]]; then
    hdiutil detach "$extract_root/mount" -quiet || true
  fi
  rm -rf "$extract_root"
}
trap cleanup EXIT

case "$original_package_path" in
  *.deb) snapshot_extension="deb" ;;
  *.rpm) snapshot_extension="rpm" ;;
  *.dmg) snapshot_extension="dmg" ;;
  *) die "unsupported installer format: $original_package_path" ;;
esac
PACKAGE_PATH="$extract_root/installer.$snapshot_extension"
"$SCRIPT_DIR/safe_extract_tar.py" \
  --snapshot-file "$original_package_path" \
  --dest "$PACKAGE_PATH" \
  --max-total-bytes 1073741824

case "$PACKAGE_PATH" in
  *.deb)
    require_command dpkg-deb
    assert_linux_package_metadata "$PACKAGE_PATH" deb "$RUNTIME_TARGET"
    runtime_dir="$extract_root/runtime"
    dpkg-deb --fsys-tarfile "$PACKAGE_PATH" |
      "$SCRIPT_DIR/extract_desktop_runtime.py" --format tar --dest "$runtime_dir"
    ;;
  *.rpm)
    require_command rpm2cpio
    assert_linux_package_metadata "$PACKAGE_PATH" rpm "$RUNTIME_TARGET"
    runtime_dir="$extract_root/runtime"
    rpm2cpio "$PACKAGE_PATH" |
      "$SCRIPT_DIR/extract_desktop_runtime.py" --format cpio --dest "$runtime_dir"
    ;;
  *.dmg)
    require_command hdiutil
    mkdir -p "$extract_root/mount"
    hdiutil attach "$PACKAGE_PATH" -readonly -nobrowse -mountpoint "$extract_root/mount" -quiet
    mounted=1
    runtime_dir="$extract_root/mount/Redeven Desktop.app/Contents/Resources/bin"
    ;;
  *)
    die "unsupported installer format: $PACKAGE_PATH"
    ;;
esac

[[ -d "$runtime_dir" && ! -L "$runtime_dir" ]] || die "installer is missing the exact runtime directory"
runtime_path="$runtime_dir/redevplugin-runtime"
redeven_path="$runtime_dir/redeven"
gateway_path="$runtime_dir/redeven-gateway"
marker_path="$runtime_dir/.redevplugin-release-artifacts-verified.json"
notices_path="$runtime_dir/REDEVPLUGIN_THIRD_PARTY_NOTICES.md"
for required in "$redeven_path" "$gateway_path" "$marker_path" "$notices_path"; do
  [[ -f "$required" && ! -L "$required" ]] || die "installer is missing a required regular runtime file: $(basename -- "$required")"
done

goos=${RUNTIME_TARGET%/*}
goarch=${RUNTIME_TARGET#*/}
assert_go_binary_target "$redeven_path" "$goos" "$goarch" "Redeven runtime"
assert_go_binary_target "$gateway_path" "$goos" "$goarch" "Redeven Gateway"
"$SCRIPT_DIR/check_redevplugin_consumption_gate.sh" \
  --scan-root "$runtime_dir" \
  --runtime-target "$RUNTIME_TARGET"
publish_receipt "$PACKAGE_PATH" "$package_name" "$runtime_path" "$marker_path" "$notices_path" "$RECEIPT_PATH"
echo "[INFO] Desktop installer ReDevPlugin runtime verified: $PACKAGE_PATH"
