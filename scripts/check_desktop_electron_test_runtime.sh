#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="${1:-$ROOT_DIR/desktop}"

DESKTOP_DIR=$(cd -- "$DESKTOP_DIR" &> /dev/null && pwd)
ELECTRON_BINARY=$(cd -- "$DESKTOP_DIR" && node -p "require('electron')")
ELECTRON_PACKAGE_JSON=$(cd -- "$DESKTOP_DIR" && node -p "require.resolve('electron/package.json')")
ELECTRON_PACKAGE_ROOT=$(dirname -- "$ELECTRON_PACKAGE_JSON")
DECLARED_ELECTRON_VERSION=$(cd -- "$DESKTOP_DIR" && node -p "require('./package.json').devDependencies.electron")
INSTALLED_ELECTRON_VERSION=$(cd -- "$DESKTOP_DIR" && node -p "require('./node_modules/electron/package.json').version")
NODE_MODULES_ROOT=$(cd -- "$DESKTOP_DIR/node_modules" &> /dev/null && pwd -P)
ELECTRON_PACKAGE_ROOT=$(cd -- "$ELECTRON_PACKAGE_ROOT" &> /dev/null && pwd -P)
EXPECTED_BINARY="$ELECTRON_PACKAGE_ROOT/dist/Electron.app/Contents/MacOS/Electron"

canonical_binary_path() {
  local binary_path=$1
  local binary_dir
  binary_dir=$(cd -- "$(dirname -- "$binary_path")" &> /dev/null && pwd -P)
  printf '%s/%s\n' "$binary_dir" "$(basename -- "$binary_path")"
}

case "$ELECTRON_PACKAGE_ROOT" in
  "$NODE_MODULES_ROOT"/*) ;;
  *)
    echo "Desktop Electron runtime preflight failed: package root is outside node_modules: $ELECTRON_PACKAGE_ROOT" >&2
    exit 1
    ;;
esac
if [ "$INSTALLED_ELECTRON_VERSION" != "$DECLARED_ELECTRON_VERSION" ]; then
  echo "Desktop Electron runtime preflight failed: installed Electron $INSTALLED_ELECTRON_VERSION does not match exact package pin $DECLARED_ELECTRON_VERSION." >&2
  exit 1
fi
if [ "$(uname -s)" = "Darwin" ] && [ "$(canonical_binary_path "$ELECTRON_BINARY")" != "$(canonical_binary_path "$EXPECTED_BINARY")" ]; then
  echo "Desktop Electron runtime preflight failed: unexpected Electron binary $ELECTRON_BINARY" >&2
  exit 1
fi
if [ ! -x "$ELECTRON_BINARY" ]; then
  echo "Desktop Electron runtime preflight failed: Electron binary is not executable: $ELECTRON_BINARY" >&2
  exit 1
fi

set +e
ELECTRON_VERSION_OUTPUT=$("$ELECTRON_BINARY" --version 2>&1)
ELECTRON_VERSION_STATUS=$?
set -e

if [ "$ELECTRON_VERSION_STATUS" -ne 0 ]; then
  echo "Desktop Electron runtime preflight failed: the npm Electron binary exited with status $ELECTRON_VERSION_STATUS." >&2
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "macOS may have rejected the official Electron runtime. Use a macOS test runtime where Electron is already executable; tests must not change the host trust chain." >&2
  fi
  if [ -n "$ELECTRON_VERSION_OUTPUT" ]; then
    printf '%s\n' "$ELECTRON_VERSION_OUTPUT" >&2
  fi
  exit 1
fi
if [ -z "$ELECTRON_VERSION_OUTPUT" ]; then
  echo "Desktop Electron runtime preflight failed: Electron returned an empty version." >&2
  exit 1
fi

printf 'Desktop Electron runtime preflight passed: %s\n' "$ELECTRON_VERSION_OUTPUT"
