#!/usr/bin/env sh
set -eu

REDEVEN_BIN="${REDEVEN_BIN:-redeven}"
exec "$REDEVEN_BIN" targets list --json "$@"
