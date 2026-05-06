#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: resolve_target.sh <target> [redeven target flags...]" >&2
  exit 2
fi

TARGET="$1"
shift

REDEVEN_BIN="${REDEVEN_BIN:-redeven}"
exec "$REDEVEN_BIN" targets resolve --target "$TARGET" --json "$@"
