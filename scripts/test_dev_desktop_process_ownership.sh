#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/redeven-dev-desktop-owner-test.XXXXXX")
trap 'rm -rf -- "$TEST_DIR"' EXIT

source "$SCRIPT_DIR/dev_desktop.sh"
ORIGINAL_WRITE_DESKTOP_OWNER_RECORD=$(declare -f write_desktop_owner_record)
ui_pkg_log() { :; }
ui_pkg_die() { exit 1; }
DEFAULT_OWNER_RECORD="$DEV_DESKTOP_OWNER_RECORD"
DEFAULT_LAUNCH_BLOCK_RECORD="$DEV_DESKTOP_LAUNCH_BLOCK_RECORD"
DEFAULT_USER_DATA_DIR="$DEV_DESKTOP_USER_DATA_DIR"
DEFAULT_TRANSITION_LOCK="$DEV_DESKTOP_TRANSITION_LOCK"
DEV_DESKTOP_OWNER_RECORD="$TEST_DIR/owner"
DEV_DESKTOP_LAUNCH_BLOCK_RECORD="$TEST_DIR/launch-block"
DEV_DESKTOP_USER_DATA_DIR="$TEST_DIR/user-data"
DEV_DESKTOP_TRANSITION_LOCK="$TEST_DIR/transition.lock"

MARKER_A="11111111-1111-4111-8111-111111111111"
MARKER_B="22222222-2222-4222-8222-222222222222"
MOCK_PID="4242"
MOCK_ALIVE=0
MOCK_COMMAND=""
MOCK_SIGNAL_MODE="stay_alive"
SIGNAL_LOG=""
STOP_TIMEOUT_SECONDS=0
DRY_RUN=0

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [ "$actual" = "$expected" ] || fail "$label: got '$actual', want '$expected'"
}

write_record() {
  local pid="$1"
  local marker="$2"
  printf 'schema=1\npid=%s\nmarker=%s\n' "$pid" "$marker" >"$DEV_DESKTOP_OWNER_RECORD"
}

reset_mock() {
  rm -f -- "$DEV_DESKTOP_OWNER_RECORD"
  rm -f -- "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD"
  MOCK_ALIVE=0
  MOCK_COMMAND=""
  MOCK_SIGNAL_MODE="stay_alive"
  SIGNAL_LOG=""
  PENDING_DESKTOP_PID=""
  PENDING_DESKTOP_MARKER=""
}

pid_exists() {
  [ "$1" = "$MOCK_PID" ] && [ "$MOCK_ALIVE" -eq 1 ]
}

process_command_line() {
  [ "$1" = "$MOCK_PID" ] || return 1
  printf '%s\n' "$MOCK_COMMAND"
}

send_signal() {
  local signal="$1"
  local pid="$2"
  SIGNAL_LOG="${SIGNAL_LOG}${SIGNAL_LOG:+,}${signal}:${pid}"
  case "$MOCK_SIGNAL_MODE:$signal" in
    fail_term:TERM|fail_kill:KILL)
      return 1
      ;;
  esac
  case "$MOCK_SIGNAL_MODE:$signal" in
    exit_on_term:TERM|exit_on_kill:KILL)
      MOCK_ALIVE=0
      ;;
    change_after_term:TERM)
      MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_B ."
      ;;
  esac
}

owned_child_exited_or_zombie() {
  [ "$1" = "$MOCK_PID" ] && [ "$MOCK_ALIVE" -eq 0 ]
}

reset_mock
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "" "missing owner record must not signal"

reset_mock
printf 'schema=1\npid=not-a-pid\nmarker=%s\n' "$MARKER_A" >"$DEV_DESKTOP_OWNER_RECORD"
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "" "invalid owner record must not signal"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "invalid owner record must be removed"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_B ."
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "" "marker mismatch must not signal"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "stale owner record must be removed"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="exit_on_term"
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "owned process should exit after TERM"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "settled owner record must be removed"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="exit_on_kill"
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID,KILL:$MOCK_PID" "owned process should receive bounded KILL"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "force-stopped owner record must be removed"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="change_after_term"
stop_owned_dev_desktop
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "changed ownership must block KILL"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "changed owner record must be removed"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="fail_term"
if stop_owned_dev_desktop; then
  fail "TERM failure must block the transition"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "TERM failure must not escalate"
[ -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "TERM failure must preserve owner evidence"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="fail_kill"
if stop_owned_dev_desktop; then
  fail "KILL failure must block the transition"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID,KILL:$MOCK_PID" "KILL failure must stay targeted"
[ -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "KILL failure must preserve owner evidence"

reset_mock
write_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
if stop_owned_dev_desktop; then
  fail "a process alive after KILL must block the transition"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID,KILL:$MOCK_PID" "alive process must receive only targeted signals"
[ -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "live owner evidence must be preserved"

STOP_EXISTING=0
if prepare_owner_state_without_stop; then
  fail "--no-stop must reject a live owner"
fi
STOP_EXISTING=1

reset_mock
write_record "$MOCK_PID" "$MARKER_B"
remove_desktop_owner_record_if_matches "$MOCK_PID" "$MARKER_A"
load_desktop_owner_record || fail "new owner record must survive stale cleanup"
assert_equal "$DESKTOP_OWNER_MARKER" "$MARKER_B" "stale cleanup must preserve the new owner"

write_desktop_owner_record "$MOCK_PID" "$MARKER_A"
expected_record=$(printf 'schema=1\npid=%s\nmarker=%s' "$MOCK_PID" "$MARKER_A")
assert_equal "$(cat "$DEV_DESKTOP_OWNER_RECORD")" "$expected_record" "owner record must publish atomically"
if [ "$(uname -s)" = "Darwin" ]; then
  user_data_mode=$(stat -f '%Lp' "$DEV_DESKTOP_USER_DATA_DIR")
else
  user_data_mode=$(stat -c '%a' "$DEV_DESKTOP_USER_DATA_DIR")
fi
assert_equal "$user_data_mode" "700" "worktree user-data permissions"

case "$DEFAULT_OWNER_RECORD:$DEFAULT_LAUNCH_BLOCK_RECORD:$DEFAULT_USER_DATA_DIR:$DEFAULT_TRANSITION_LOCK" in
  "$WORKTREE_GIT_DIR"/*:"$WORKTREE_GIT_DIR"/*:"$WORKTREE_GIT_DIR"/*:"$WORKTREE_GIT_DIR"/*) ;;
  *) fail "Dev Desktop state must derive from the current worktree Git admin directory" ;;
esac
[ "$DEFAULT_OWNER_RECORD" != "$DEFAULT_USER_DATA_DIR" ] || fail "owner and user-data paths must differ"
[ "$DEFAULT_OWNER_RECORD" != "$DEFAULT_TRANSITION_LOCK" ] || fail "owner and transition paths must differ"

(
  rm -rf -- "$DEV_DESKTOP_TRANSITION_LOCK"
  acquire_transition_lock
  [ -f "$DEV_DESKTOP_TRANSITION_LOCK/owner" ] || fail "transition lock must publish owner evidence"
  release_held_transition_lock
  [ ! -e "$DEV_DESKTOP_TRANSITION_LOCK" ] || fail "owned transition lock must release atomically"

  acquire_transition_lock
  mv() { return 1; }
  if release_held_transition_lock; then
    fail "transition lock publication failure must fail closed"
  fi
  [ -n "$HELD_TRANSITION_MARKER" ] || fail "failed transition release must retain retry ownership"
  unset -f mv
  release_held_transition_lock

  mkdir -m 700 -- "$DEV_DESKTOP_TRANSITION_LOCK"
  printf 'pid=%s\nmarker=%s\n' "$MOCK_PID" "4242-7-1700000000" >"$DEV_DESKTOP_TRANSITION_LOCK/owner"
  MOCK_ALIVE=1
  if (acquire_transition_lock); then
    fail "a concurrent live transition must be rejected"
  fi
  rm -rf -- "$DEV_DESKTOP_TRANSITION_LOCK"
)

stop_body=$(declare -f stop_owned_dev_desktop)
if printf '%s\n' "$stop_body" | grep -Eq 'pgrep|lsof|osascript|process_cwd|application id'; then
  fail "Dev Desktop stop authority must not use process discovery fallbacks"
fi

start_body=$(declare -f start_desktop)
for launch_contract in \
  'cmd+=("--user-data-dir=$DEV_DESKTOP_USER_DATA_DIR")' \
  'cmd+=("$DEV_DESKTOP_OWNER_SWITCH=$launch_marker")' \
  'electron_binary=' \
  'desktop_pid=$!' \
  'wait_for_desktop_launch_identity "$desktop_pid" "$launch_marker"' \
  'write_desktop_owner_record "$desktop_pid" "$launch_marker"' \
  'wait "$desktop_pid"'; do
  printf '%s\n' "$start_body" | grep -Fq "$launch_contract" \
    || fail "Dev Desktop launch must bind the exact Electron PID, marker, and worktree user-data"
done

transition_body=$(declare -f acquire_transition_lock)
for transition_contract in \
  'trap handle_script_exit EXIT' \
  "trap 'exit 130' INT" \
  "trap 'exit 143' TERM"; do
  printf '%s\n' "$transition_body" | grep -Fq "$transition_contract" \
    || fail "transition signals must exit before releasing ownership"
done

identity_body=$(declare -f wait_for_desktop_launch_identity)
if printf '%s\n' "$identity_body" | grep -Fq 'seq '; then
  fail "launch identity polling must not depend on the external seq command"
fi

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_B ."
if terminate_pending_desktop_child; then
  fail "unpublished child marker mismatch must fail closed"
fi
assert_equal "$SIGNAL_LOG" "" "unpublished child marker mismatch must not signal"
assert_equal "$PENDING_DESKTOP_PID" "$MOCK_PID" "marker mismatch must retain pending evidence"
load_desktop_launch_block_record || fail "marker mismatch must retain a durable launch block"
if (reconcile_desktop_launch_block); then
  fail "live marker mismatch must block the next transition"
fi

MOCK_ALIVE=0
reconcile_desktop_launch_block
[ ! -e "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD" ] || fail "exited unresolved PID must clear its launch block"

reset_mock
write_desktop_launch_block_record "$MOCK_PID" "$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
reconcile_desktop_launch_block
[ ! -e "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD" ] || fail "verified launch block must convert to owner evidence"
load_desktop_owner_record || fail "verified launch block must publish owner evidence"
assert_equal "$DESKTOP_OWNER_MARKER" "$MARKER_A" "recovered launch owner marker"

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="exit_on_term"
terminate_pending_desktop_child
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "unpublished child should exit after targeted TERM"
assert_equal "$PENDING_DESKTOP_PID" "" "unpublished child ownership must clear after cleanup"

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="exit_on_kill"
terminate_pending_desktop_child
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID,KILL:$MOCK_PID" "unpublished child cleanup must use bounded targeted KILL"
assert_equal "$PENDING_DESKTOP_PID" "" "forced unpublished child ownership must clear after cleanup"

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="change_after_term"
if terminate_pending_desktop_child; then
  fail "pending child identity change after TERM must fail closed"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "changed pending identity must block KILL"
assert_equal "$PENDING_DESKTOP_PID" "$MOCK_PID" "changed pending identity must retain pending evidence"
load_desktop_launch_block_record || fail "changed pending identity must retain a durable launch block"
if (reconcile_desktop_launch_block); then
  fail "changed pending identity must block the next transition"
fi

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="fail_kill"
if terminate_pending_desktop_child; then
  fail "unpublished child KILL failure must fail closed"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID,KILL:$MOCK_PID" "unpublished child KILL failure must stay targeted"
assert_equal "$PENDING_DESKTOP_PID" "$MOCK_PID" "failed unpublished child cleanup must retain pending evidence"
load_desktop_owner_record || fail "failed unpublished child cleanup must retain durable owner evidence"
assert_equal "$DESKTOP_OWNER_MARKER" "$MARKER_A" "failed unpublished child owner evidence marker"
if prepare_owner_state_without_stop; then
  fail "retained unpublished child evidence must block --no-stop replacement"
fi

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
MOCK_SIGNAL_MODE="fail_term"
if terminate_pending_desktop_child; then
  fail "unpublished child TERM failure must fail closed"
fi
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "unpublished child TERM failure must not escalate"
[ -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "unpublished child TERM failure must retain durable owner evidence"

reset_mock
PENDING_DESKTOP_PID="$MOCK_PID"
PENDING_DESKTOP_MARKER="$MARKER_A"
MOCK_ALIVE=1
MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
write_desktop_owner_record() { return 1; }
if terminate_pending_desktop_child; then
  fail "owner publication failure must block pending cleanup"
fi
unset -f write_desktop_owner_record
eval "$ORIGINAL_WRITE_DESKTOP_OWNER_RECORD"
assert_equal "$SIGNAL_LOG" "" "owner publication failure must not signal"
assert_equal "$PENDING_DESKTOP_PID" "$MOCK_PID" "owner publication failure must retain pending evidence"
load_desktop_launch_block_record || fail "owner publication failure must retain a durable launch block"
send_signal() {
  [ -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "recovered cleanup must publish owner evidence before signaling"
  SIGNAL_LOG="${SIGNAL_LOG}${SIGNAL_LOG:+,}$1:$2"
  MOCK_ALIVE=0
}
terminate_pending_desktop_child
assert_equal "$SIGNAL_LOG" "TERM:$MOCK_PID" "recovered owner publication may settle its exact pending child"
[ ! -e "$DEV_DESKTOP_LAUNCH_BLOCK_RECORD" ] || fail "recovered pending cleanup must clear its launch block"
[ ! -e "$DEV_DESKTOP_OWNER_RECORD" ] || fail "settled recovered pending cleanup must clear owner evidence"

handler_dir="$TEST_DIR/handler"
mkdir -p -- "$handler_dir"
(
  DEV_DESKTOP_OWNER_RECORD="$handler_dir/owner"
  DEV_DESKTOP_USER_DATA_DIR="$handler_dir/user-data"
  DEV_DESKTOP_TRANSITION_LOCK="$handler_dir/transition.lock"
  acquire_transition_lock
  PENDING_DESKTOP_PID="$MOCK_PID"
  PENDING_DESKTOP_MARKER="$MARKER_A"
  MOCK_ALIVE=1
  MOCK_COMMAND="Electron $DEV_DESKTOP_OWNER_SWITCH=$MARKER_A ."
  MOCK_SIGNAL_MODE="exit_on_term"
  send_signal() {
    printf '%s:%s\n' "$1" "$2" >>"$handler_dir/signals"
    MOCK_ALIVE=0
  }
  handle_script_exit
  printf 'continued\n' >"$handler_dir/sentinel"
)
[ ! -e "$handler_dir/transition.lock" ] || fail "exit handler must release the exact transition lock"
[ ! -e "$handler_dir/sentinel" ] || fail "exit handler must not continue the transition"
assert_equal "$(cat "$handler_dir/signals")" "TERM:$MOCK_PID" "exit handler must settle only its pending child"

echo "Dev Desktop process ownership checks passed."
