#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/redeven-desktop-inventory.XXXXXX")
FAKE_CHECKOUT="$TEST_ROOT/redeven-fix-arbitrary-topic"
FAKE_DESKTOP="$FAKE_CHECKOUT/desktop"
FAKE_PID=""

cleanup() {
  if [ -n "$FAKE_PID" ]; then
    kill "$FAKE_PID" >/dev/null 2>&1 || true
    wait "$FAKE_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_CHECKOUT/.git" "$FAKE_DESKTOP"
printf '%s\n' '{"name":"@floegence/redeven-desktop"}' > "$FAKE_DESKTOP/package.json"

(
  cd "$FAKE_DESKTOP"
  exec -a electron sleep 30
) &
FAKE_PID=$!

for _ in 1 2 3 4 5; do
  if kill -0 "$FAKE_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

output=$("$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
if ! printf '%s\n' "$output" | rg -q "Stopping Redeven Desktop processes:.*[[:space:]]$FAKE_PID([[:space:]]|$)"; then
  printf '%s\n' "$output" >&2
  printf 'expected cross-worktree desktop PID %s in dry-run inventory\n' "$FAKE_PID" >&2
  exit 1
fi

printf 'dev desktop process inventory test passed\n'
