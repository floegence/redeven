#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/build_runtime_binary.sh \
    --goos <linux|darwin> \
    --goarch <amd64|arm64> \
    --output <path> \
    --command <./cmd/redeven|./cmd/redeven-gateway> \
    --version <version> \
    --commit <commit> \
    --build-time <RFC3339 timestamp> \
    [--relink-dir <empty directory>]

  ./scripts/build_runtime_binary.sh \
    --check-only \
    --goos <linux|darwin> \
    --goarch <amd64|arm64>

Builds one Redeven runtime command with the native Floeterm engine. Linux
artifacts statically link the published GNU native archive and its C/C++
libraries, so the same binary runs on glibc and musl hosts. Linux builders need
GNU C/C++ compilers and static development libraries. Cross builds need the
matching <arch>-linux-gnu or <arch>-unknown-linux-gnu toolchain. Darwin builds
use the matching native Apple toolchain.
USAGE
}

die() {
  echo "Redeven runtime build failed: $*" >&2
  exit 1
}

GOOS=""
GOARCH=""
OUTPUT_PATH=""
COMMAND_PATH=""
VERSION=""
COMMIT=""
BUILD_TIME=""
CHECK_ONLY=0
RELINK_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --goos)
      GOOS="${2:-}"
      shift 2
      ;;
    --goarch)
      GOARCH="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    --command)
      COMMAND_PATH="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --commit)
      COMMIT="${2:-}"
      shift 2
      ;;
    --build-time)
      BUILD_TIME="${2:-}"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift 1
      ;;
    --relink-dir)
      RELINK_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unexpected argument: $1"
      ;;
  esac
done

case "$GOOS/$GOARCH" in
  linux/amd64|linux/arm64|darwin/amd64|darwin/arm64) ;;
  *) die "unsupported target: ${GOOS:-<empty>}/${GOARCH:-<empty>}" ;;
esac
command -v go >/dev/null 2>&1 || die "go is required"

host_goos=$(go env GOHOSTOS)
host_goarch=$(go env GOHOSTARCH)
[[ -n "$host_goos" && -n "$host_goarch" ]] || die "go did not report a complete host platform"

build_environment=(
  "GOWORK=off"
  "GOOS=$GOOS"
  "GOARCH=$GOARCH"
  "CGO_ENABLED=1"
)
build_tags="floeterm_native"
link_flags=""
if [[ "$GOOS" == "linux" ]]; then
  case "$GOOS/$GOARCH" in
    linux/amd64) target_cpu="x86_64" ;;
    linux/arm64) target_cpu="aarch64" ;;
  esac
  compiler_prefix=""
  for candidate in "$target_cpu-linux-gnu-" "$target_cpu-unknown-linux-gnu-"; do
    if command -v "${candidate}gcc" >/dev/null 2>&1 && command -v "${candidate}g++" >/dev/null 2>&1; then
      compiler_prefix="$candidate"
      break
    fi
  done
  if [[ -z "$compiler_prefix" && "$host_goos/$host_goarch" != "$GOOS/$GOARCH" ]]; then
    die "GNU C and C++ compilers are required for $GOOS/$GOARCH; install a $target_cpu-linux-gnu toolchain with static libraries"
  fi
  command -v "${compiler_prefix}gcc" >/dev/null 2>&1 && command -v "${compiler_prefix}g++" >/dev/null 2>&1 ||
    die "GNU C and C++ compilers are required for $GOOS/$GOARCH"
  probe_dir=$(mktemp -d)
  trap 'rm -rf "$probe_dir"' EXIT
  if ! printf 'int main(void) { return 0; }\n' | "${compiler_prefix}gcc" -x c - -static -lstdc++ -lrt -lpthread -o "$probe_dir/static-probe"; then
    die "static GNU C/C++ libraries are required for $GOOS/$GOARCH; install the target libc and C++ development libraries"
  fi
  build_environment+=(
    "CC=${compiler_prefix}gcc"
    "CXX=${compiler_prefix}g++"
  )
  # The published Floeterm archive uses GNU libc symbols. Static GNU linkage
  # keeps those symbols without depending on the host's dynamic loader or NSS.
  build_tags+=",netgo,osusergo"
  link_flags="-linkmode external -extldflags '-static -lrt -lpthread'"
elif [[ "$host_goos/$host_goarch" != "$GOOS/$GOARCH" ]]; then
  die "cross-compiling $GOOS/$GOARCH from $host_goos/$host_goarch is unsupported; use a matching native builder"
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  exit 0
fi

case "$COMMAND_PATH" in
  ./cmd/redeven|./cmd/redeven-gateway) ;;
  *) die "unsupported runtime command: ${COMMAND_PATH:-<empty>}" ;;
esac
[[ -n "$OUTPUT_PATH" ]] || die "--output is required"
[[ -n "$VERSION" ]] || die "--version is required"
[[ -n "$COMMIT" ]] || die "--commit is required"
[[ -n "$BUILD_TIME" ]] || die "--build-time is required"

mkdir -p "$(dirname -- "$OUTPUT_PATH")"
if [[ -n "$RELINK_DIR" ]]; then
  [[ "$GOOS" == linux ]] || die "relink objects are supported only for Linux"
  [[ ! -e "$RELINK_DIR" ]] || die "relink directory must not already exist"
  mkdir -p "$RELINK_DIR/objects"
  RELINK_DIR=$(cd "$RELINK_DIR" && pwd)
  # Keep all combined Go/C objects so recipients can relink against a modified
  # LGPL C library without rebuilding or obtaining any private component.
  link_flags+=" -tmpdir '$RELINK_DIR/objects' -v"
fi
build_runtime() (
  cd "$ROOT_DIR"
  env "${build_environment[@]}" \
    go build \
      -tags "$build_tags" \
      -trimpath \
      -ldflags "-s -w $link_flags -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.BuildTime=${BUILD_TIME}" \
      -o "$OUTPUT_PATH" \
      "$COMMAND_PATH"
)
if [[ -n "$RELINK_DIR" ]]; then
  if ! build_runtime 2> "$RELINK_DIR/link.log"; then
    cat "$RELINK_DIR/link.log" >&2
    exit 1
  fi
  python3 "$SCRIPT_DIR/collect_runtime_relink.py" "$RELINK_DIR" "$(basename -- "$OUTPUT_PATH")"
else
  build_runtime
fi
