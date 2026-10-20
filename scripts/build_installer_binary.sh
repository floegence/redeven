#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
GOOS=""
GOARCH=""
VERSION=""
OUTPUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --goos) GOOS="${2:?missing --goos value}"; shift 2 ;;
    --goarch) GOARCH="${2:?missing --goarch value}"; shift 2 ;;
    --version) VERSION="${2:?missing --version value}"; shift 2 ;;
    --output) OUTPUT="${2:?missing --output value}"; shift 2 ;;
    -h|--help)
      echo 'Usage: build_installer_binary.sh --goos <linux|darwin> --goarch <amd64|arm64> --version <vX.Y.Z> --output <path>'
      exit 0 ;;
    *) echo "Unexpected installer build argument: $1" >&2; exit 2 ;;
  esac
done
case "$GOOS/$GOARCH" in
  linux/amd64|linux/arm64|darwin/amd64|darwin/arm64) ;;
  *) echo 'Unsupported installer target' >&2; exit 2 ;;
esac
if [[ -z "$OUTPUT" ]] || ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo 'Installer output and a canonical release version are required' >&2
  exit 2
fi
if [[ "$OUTPUT" != /* ]]; then OUTPUT="$PWD/$OUTPUT"; fi
mkdir -p "$(dirname -- "$OUTPUT")"
cd "$ROOT_DIR"
# No compiler, dynamic Go runtime, or third-party executable is required on
# the receiving host. Exclude mutable build timestamps and local VCS state.
CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" GOWORK=off \
  go build -trimpath -buildvcs=false \
  -ldflags "-s -w -X main.Version=$VERSION" \
  -o "$OUTPUT" ./cmd/redeven-installer
