#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
desktop_root="$repo_root/desktop"
native_root="$desktop_root/native/macos-updater"
stage_root="$desktop_root/.bundle/macos-updater"
electron_version=$(node -p "require('$desktop_root/node_modules/electron/package.json').version")
target_arch=${REDEVEN_DESKTOP_NODE_ARCH:-$(node -p 'process.arch')}

case "$target_arch" in
  x64|arm64) ;;
  *)
    echo "Unsupported macOS updater architecture: $target_arch" >&2
    exit 64
    ;;
esac

swift package resolve --package-path "$native_root"
sparkle_distribution="$native_root/.build/artifacts/sparkle/Sparkle"
sparkle_framework="$sparkle_distribution/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
[[ -d "$sparkle_framework" ]] || {
  echo "Resolved Sparkle framework is missing: $sparkle_framework" >&2
  exit 1
}

sparkle_headers_root="$native_root/.build/redeven-sparkle-headers"
rm -rf "$sparkle_headers_root"
mkdir -p "$sparkle_headers_root"
ln -s "$sparkle_framework/Headers" "$sparkle_headers_root/Sparkle"

"$desktop_root/node_modules/.bin/node-gyp" rebuild \
  --directory="$native_root" \
  --target="$electron_version" \
  --arch="$target_arch" \
  --dist-url=https://electronjs.org/headers \
  --sparkle_framework_dir="$sparkle_framework" \
  --sparkle_headers_root="$sparkle_headers_root"

addon="$native_root/build/Release/redeven_sparkle.node"
[[ -f "$addon" ]] || {
  echo "Sparkle bridge was not built: $addon" >&2
  exit 1
}

stage_tmp=$(mktemp -d "${TMPDIR:-/tmp}/redeven-sparkle-stage.XXXXXX")
cleanup() {
  rm -rf "$stage_tmp"
}
trap cleanup EXIT
mkdir -p "$stage_tmp/native"
/usr/bin/ditto "$sparkle_framework" "$stage_tmp/Sparkle.framework"
cp "$addon" "$stage_tmp/native/redeven_sparkle.node"

mkdir -p "$(dirname "$stage_root")"
rm -rf "$stage_root"
mv "$stage_tmp" "$stage_root"
trap - EXIT
