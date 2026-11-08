---
type: AI Tool Contract
title: AI terminal tool runtime
tags: [ai, terminal, tools, runtime]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven owns PTYs and bounded output; Floret v7 owns canonical tool calls, interactions, effect attempts, results and Activity. [Task-file placement](flower-task-files.md) supplies thread scratch/staging through child-only environment variables while preserving project cwd and OS temporary path conventions.

# Contract

Cleanup waits for owned processes to be reaped. PTYs use Floret execution/effect
identities. `terminal.exec` defaults to a 5-second initial wait (omitted/zero
`yield_ms`); positive waits cap at 30 seconds. Yield returns a live process ID,
not termination. Commands have a disclosed 30-minute lifetime. Terminate/Service
shutdown stop owned processes; cancellation during initial exec wait stops the
command, while later read cancellation preserves it.

Simple text/rule reads and discovery use shared [file tools](tool-permission-runtime.md#file-inspection).
Shell remains available for pipelines/specialized formats; browser previews use
managed discover/select/exec. Guidance never changes ownership or permission.

`cwd` is preferred; `workdir` is equivalent. Both empty use run cwd; relative paths
resolve there. Two nonempty fields must resolve to the same authorized directory,
including symlinks. Neither wins. Conflict returns `INVALID_PATH`,
`reason=conflicting_working_directories`, `process_started=false` before admission
or process creation.

On macOS/Linux, one exit worker observes without reaping, kills the process group,
retires numeric signaling, verifies no members within 2 seconds, then reaps/drains.
The unreaped root pins PID through cleanup. Child cleanup preserves shell exit
codes; only confirmed Stop means cancellation. Stop/input failure/30-minute limit/
shutdown share this worker. Unconfirmed cleanup reports runtime error and retains
workload admission; settlement stops the watchdog. Foreground processes use their
returned ID. Backgrounding/nohup cannot transfer ownership; escaping PTY group or
session is unsupported. Independent services need managed lifecycle. Names, CPU
and age never prove ownership.

`terminal.read` returns bounded incremental output after `after_seq`, up to 60
seconds or earlier on output/exit. Normal expiry reports `wait_expired`/`wait_ms`
and retains ID/cursor; `timed_out` means command timeout. Continue with returned
`last_seq`, without sleeps/restarts. Published Floret BoundedWait measures handler
time and owns repeat protection; immediate/failed/canceled/early reads and nearby
effects get no exemption. No extra retry counters, clocks, wakes or durable ledger.

Read cancellation preserves process/cursor and confirms cancellation after
observation returns. Execution/input retain uncertain-effect rules. `terminal.write`
bounds stdin; terminate kills the group and waits for reap/drain. Thread Stop owns
cleanup policy. Model output carries output/status/cursor/wait/exit facts, without
repeating command/cwd/timing from canonical Activity. Browser payloads exclude
local paths, stdin, authorization proofs and effect internals.

Completion Activity previews whole UTF-8 chunks within 8,000 bytes. Full retained
chunks seal independently; preview truncation/watermarks describe only shown bytes.
Completion omits invocation-owned command/cwd. Persistence failures log bounded
identities immediately and remain shutdown errors, never trigger replay.

# Boundaries

No authority barriers, admission receipts, recovery handles or projection-cursor
waits. Reads never retry settlement. Detail polling refreshes bytes, never canonical
status or provider dispatch.

# Evidence

- [Local feedback](../../internal/ai/local_tool_feedback_test.go): default/single/
  equivalent/symlink/conflicting cwd. [Service acceptance](../../internal/ai/local_tool_feedback_integration_test.go):
  pre-effect rejection, explicit correction with real PTY, HTTP, Activity and
  restart without replay on published Floret and synthetic providers.
- `redeven:internal/ai/floret_effect_authorization.go`: authorization owner.
- [Wait integration](../../internal/ai/terminal_wait_floret_integration_test.go):
  quiet repeated reads and mixed-effect repeat protection.
- [Cleanup](../../internal/ai/terminal_process_cleanup_unix_test.go): ignored-HUP
  children, exit codes, Stop/Close/cancellation/timeouts/input failures, pinned
  identity, failure admission and unrelated-process isolation.
