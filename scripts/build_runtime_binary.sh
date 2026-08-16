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
    --build-time <RFC3339 timestamp>

  ./scripts/build_runtime_binary.sh \
    --check-only \
    --goos <linux|darwin> \
    --goarch <amd64|arm64>

Builds one Redeven runtime command with the native Floeterm engine. Native
targets use the host C toolchain. Cross-compiled Linux targets use Zig's
explicit GNU target so cgo never falls back to the host compiler or SDK.
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
if [[ "$host_goos/$host_goarch" != "$GOOS/$GOARCH" ]]; then
  case "$GOOS/$GOARCH" in
    linux/amd64) zig_target="x86_64-linux-gnu" ;;
    linux/arm64) zig_target="aarch64-linux-gnu" ;;
    *)
      die "cross-compiling $GOOS/$GOARCH from $host_goos/$host_goarch is unsupported; use a matching native builder"
      ;;
  esac
  command -v zig >/dev/null 2>&1 ||
    die "Zig is required to cross-compile the $GOOS/$GOARCH cgo runtime from $host_goos/$host_goarch; install Zig and retry"
  build_environment+=(
    "CC=zig cc -target $zig_target"
    "CXX=zig c++ -target $zig_target"
  )
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
(
  cd "$ROOT_DIR"
  env "${build_environment[@]}" \
    go build \
      -tags floeterm_native \
      -trimpath \
      -ldflags "-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.BuildTime=${BUILD_TIME}" \
      -o "$OUTPUT_PATH" \
      "$COMMAND_PATH"
)
