#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
DESKTOP_DIR="${1:-$ROOT_DIR/desktop}"

DESKTOP_DIR=$(cd -- "$DESKTOP_DIR" &> /dev/null && pwd)
ELECTRON_BINARY=$(cd -- "$DESKTOP_DIR" && node -p "require('electron')")
EXPECTED_BINARY="$DESKTOP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ "$(uname -s)" = "Darwin" ] && [ "$ELECTRON_BINARY" != "$EXPECTED_BINARY" ]; then
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
