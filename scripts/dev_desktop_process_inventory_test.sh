#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/redeven-desktop-inventory.XXXXXX")
TEST_ROOT=$(cd "$TEST_ROOT" && pwd -P)
FAKE_CHECKOUT="$TEST_ROOT/redeven-fix-arbitrary-topic"
FAKE_DESKTOP="$FAKE_CHECKOUT/desktop"
FAKE_SCRIPTS="$FAKE_CHECKOUT/scripts"
OWN_PID=""
OTHER_PID=""
BUSY_PORT_PID=""

cleanup() {
  [ -z "$OWN_PID" ] || kill "$OWN_PID" >/dev/null 2>&1 || true
  [ -z "$OTHER_PID" ] || kill "$OTHER_PID" >/dev/null 2>&1 || true
  [ -z "$BUSY_PORT_PID" ] || kill "$BUSY_PORT_PID" >/dev/null 2>&1 || true
  [ -z "$OWN_PID" ] || wait "$OWN_PID" >/dev/null 2>&1 || true
  [ -z "$OTHER_PID" ] || wait "$OTHER_PID" >/dev/null 2>&1 || true
  [ -z "$BUSY_PORT_PID" ] || wait "$BUSY_PORT_PID" >/dev/null 2>&1 || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_CHECKOUT/.git" "$FAKE_DESKTOP" "$FAKE_SCRIPTS"
printf '%s\n' '{"name":"@floegence/redeven-desktop"}' > "$FAKE_DESKTOP/package.json"
cp "$ROOT_DIR/scripts/dev_desktop.sh" "$ROOT_DIR/scripts/ui_package_common.sh" "$FAKE_SCRIPTS/"

(
  cd "$ROOT_DIR/desktop"
  exec -a electron sleep 30
) &
OWN_PID=$!

(
  cd "$FAKE_DESKTOP"
  exec -a electron sleep 30
) &
OTHER_PID=$!

for _ in 1 2 3 4 5; do
  if kill -0 "$OWN_PID" >/dev/null 2>&1 && kill -0 "$OTHER_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

TEST_HOME="$TEST_ROOT/home"
mkdir -p "$TEST_HOME"
output=$(HOME="$TEST_HOME" "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
if ! printf '%s\n' "$output" | rg -q "Stopping Redeven Desktop processes:.*[[:space:]]$OWN_PID([[:space:]]|$)"; then
  printf '%s\n' "$output" >&2
  printf 'expected current-checkout desktop PID %s in dry-run inventory\n' "$OWN_PID" >&2
  exit 1
fi
if printf '%s\n' "$output" | rg -q "Stopping Redeven Desktop processes:.*[[:space:]]$OTHER_PID([[:space:]]|$)"; then
  printf '%s\n' "$output" >&2
  printf 'must not inventory another checkout desktop PID %s\n' "$OTHER_PID" >&2
  exit 1
fi
if printf '%s\n' "$output" | rg -q 'ask macOS to quit Redeven Desktop'; then
  printf '%s\n' "$output" >&2
  printf 'must not request a global macOS application quit\n' >&2
  exit 1
fi

state_root=$(printf '%s\n' "$output" | sed -n 's/^Development state root: //p' | head -n 1)
if [ -z "$state_root" ] || [ "$state_root" = "$TEST_HOME/.redeven" ]; then
  printf '%s\n' "$output" >&2
  printf 'expected an isolated default development state root\n' >&2
  exit 1
fi
second_output=$(HOME="$TEST_HOME" "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
second_state_root=$(printf '%s\n' "$second_output" | sed -n 's/^Development state root: //p' | head -n 1)
if [ "$second_state_root" != "$state_root" ]; then
  printf 'expected stable state root across restarts: %s != %s\n' "$state_root" "$second_state_root" >&2
  exit 1
fi

local_ui_port=$(printf '%s\n' "$output" | sed -n 's/^Development Local UI: .*://p' | head -n 1)
cdp_port=$(printf '%s\n' "$output" | sed -n 's/^Development CDP port: //p' | head -n 1)
inspect_port=$(printf '%s\n' "$output" | sed -n 's/^Development inspect port: //p' | head -n 1)
second_local_ui_port=$(printf '%s\n' "$second_output" | sed -n 's/^Development Local UI: .*://p' | head -n 1)
second_cdp_port=$(printf '%s\n' "$second_output" | sed -n 's/^Development CDP port: //p' | head -n 1)
second_inspect_port=$(printf '%s\n' "$second_output" | sed -n 's/^Development inspect port: //p' | head -n 1)
if [ "$local_ui_port/$cdp_port/$inspect_port" != "$second_local_ui_port/$second_cdp_port/$second_inspect_port" ]; then
  printf 'expected stable checkout-derived ports: %s/%s/%s != %s/%s/%s\n' \
    "$local_ui_port" "$cdp_port" "$inspect_port" \
    "$second_local_ui_port" "$second_cdp_port" "$second_inspect_port" >&2
  exit 1
fi
for port in "$local_ui_port" "$cdp_port" "$inspect_port"; do
  case "$port" in
    ''|*[!0-9]*)
      printf 'expected numeric checkout-derived port, got %s\n' "$port" >&2
      exit 1
      ;;
  esac
  if [ "$port" -lt 1024 ] || [ "$port" -gt 65535 ]; then
    printf 'checkout-derived port is outside the valid development range: %s\n' "$port" >&2
    exit 1
  fi
done
if [ "$local_ui_port" = "$cdp_port" ] || [ "$local_ui_port" = "$inspect_port" ] || [ "$cdp_port" = "$inspect_port" ]; then
  printf 'checkout-derived ports must be distinct: %s/%s/%s\n' "$local_ui_port" "$cdp_port" "$inspect_port" >&2
  exit 1
fi

other_output=$(HOME="$TEST_HOME" "$FAKE_SCRIPTS/dev_desktop.sh" --dry-run --stop-only)
other_local_ui_port=$(printf '%s\n' "$other_output" | sed -n 's/^Development Local UI: .*://p' | head -n 1)
other_cdp_port=$(printf '%s\n' "$other_output" | sed -n 's/^Development CDP port: //p' | head -n 1)
other_inspect_port=$(printf '%s\n' "$other_output" | sed -n 's/^Development inspect port: //p' | head -n 1)
for own_port in "$local_ui_port" "$cdp_port" "$inspect_port"; do
  for other_port in "$other_local_ui_port" "$other_cdp_port" "$other_inspect_port"; do
    if [ "$own_port" = "$other_port" ]; then
      printf 'different checkouts must use non-overlapping port windows: %s/%s/%s vs %s/%s/%s\n' \
        "$local_ui_port" "$cdp_port" "$inspect_port" \
        "$other_local_ui_port" "$other_cdp_port" "$other_inspect_port" >&2
      exit 1
    fi
  done
done

explicit_port_output=$(HOME="$TEST_HOME" \
  REDEVEN_DESKTOP_LOCAL_UI_BIND=localhost:32140 \
  REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT=32141 \
  REDEVEN_DESKTOP_INSPECT_PORT=32142 \
  "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
case "$explicit_port_output" in
  *'Development Local UI: localhost:32140'*'Development CDP port: 32141'*'Development inspect port: 32142'*) ;;
  *)
    printf '%s\n' "$explicit_port_output" >&2
    printf 'expected explicit development port overrides to win\n' >&2
    exit 1
    ;;
esac

help_output=$("$ROOT_DIR/scripts/dev_desktop.sh" --help)
if ! printf '%s\n' "$help_output" | rg -q 'checkout-derived'; then
  printf '%s\n' "$help_output" >&2
  printf 'expected help to document checkout-derived default ports\n' >&2
  exit 1
fi

override_root=$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$TEST_ROOT/explicit-state")
override_output=$(HOME="$TEST_HOME" REDEVEN_STATE_ROOT="$override_root" "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
case "$override_output" in
  *"Development state root: $override_root"*) ;;
  *)
    printf '%s\n' "$override_output" >&2
    printf 'expected explicit isolated state-root override\n' >&2
    exit 1
    ;;
esac

if HOME="$TEST_HOME" REDEVEN_STATE_ROOT="$TEST_HOME/.redeven" \
  "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only >"$TEST_ROOT/user-state.out" 2>&1; then
  printf 'expected implicit user state-root reuse to fail\n' >&2
  exit 1
fi
if ! rg -q 'REDEVEN_DEV_ALLOW_USER_STATE_ROOT=1' "$TEST_ROOT/user-state.out"; then
  cat "$TEST_ROOT/user-state.out" >&2
  printf 'expected explicit user-state opt-in guidance\n' >&2
  exit 1
fi

mkdir -p "$TEST_HOME/.redeven"
ln -s "$TEST_HOME/.redeven" "$TEST_ROOT/user-state-link"
if HOME="$TEST_HOME" REDEVEN_STATE_ROOT="$TEST_ROOT/user-state-link" \
  "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only >"$TEST_ROOT/user-state-link.out" 2>&1; then
  printf 'expected a symlink to the user state root to require explicit opt-in\n' >&2
  exit 1
fi
if ! rg -q 'REDEVEN_DEV_ALLOW_USER_STATE_ROOT=1' "$TEST_ROOT/user-state-link.out"; then
  cat "$TEST_ROOT/user-state-link.out" >&2
  printf 'expected symlinked user-state opt-in guidance\n' >&2
  exit 1
fi

opt_in_output=$(HOME="$TEST_HOME" REDEVEN_STATE_ROOT="$TEST_HOME/.redeven" \
  REDEVEN_DEV_ALLOW_USER_STATE_ROOT=1 "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --stop-only)
case "$opt_in_output" in
  *'WARNING: development launch explicitly uses the user state root'*) ;;
  *)
    printf '%s\n' "$opt_in_output" >&2
    printf 'expected prominent user-state opt-in warning\n' >&2
    exit 1
    ;;
esac

node -e '
  const fs = require("node:fs");
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[1], String(server.address().port)));
' "$TEST_ROOT/busy-port" &
BUSY_PORT_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ ! -s "$TEST_ROOT/busy-port" ] || break
  sleep 0.1
done
busy_port=$(cat "$TEST_ROOT/busy-port")
if HOME="$TEST_HOME" REDEVEN_STATE_ROOT="$override_root" \
  REDEVEN_DESKTOP_LOCAL_UI_BIND="127.0.0.1:$busy_port" \
  REDEVEN_DESKTOP_REMOTE_DEBUGGING_PORT=0 REDEVEN_DESKTOP_INSPECT_PORT=0 \
  "$ROOT_DIR/scripts/dev_desktop.sh" --dry-run --no-stop >"$TEST_ROOT/busy-port.out" 2>&1; then
  cat "$TEST_ROOT/busy-port.out" >&2
  printf 'expected an occupied development port to fail before launch\n' >&2
  exit 1
fi
if ! rg -q "Local UI port $busy_port is already in use" "$TEST_ROOT/busy-port.out"; then
  cat "$TEST_ROOT/busy-port.out" >&2
  printf 'expected an actionable occupied-port diagnostic\n' >&2
  exit 1
fi

printf 'dev desktop process inventory test passed\n'
