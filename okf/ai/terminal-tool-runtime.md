---
type: AI Tool Contract
title: AI terminal tool runtime
tags: [ai, terminal, tools, runtime]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Redeven owns PTYs and bounded output; Floret v7 owns canonical tool calls, interactions, effect attempts, results and Activity. One adapter authorizes execution once and publishes current views. Product SQL stores no parallel terminal lifecycle or effect recovery.

# Contract

[Task-file placement](flower-task-files.md) supplies thread scratch/staging through
child-only environment variables while preserving project cwd and OS temporary
path conventions. Cleanup waits for owned terminal processes to be reaped.

PTYs use Floret execution/effect identities. `terminal.exec` waits 5 seconds when `yield_ms` is omitted or zero; positive values cap at 30 seconds. Yield returns a running process ID without stopping the command.

`cwd` is the preferred working-directory field; `workdir` has the same semantics. When both fields are empty, the run working directory is used; relative paths resolve from it. Two nonempty fields must resolve to the same authorized directory, including equivalent symlink paths. Neither takes precedence. A conflict retains `INVALID_PATH`, with `reason=conflicting_working_directories` and `process_started=false`; rejection precedes host-work admission and process creation.

On macOS/Linux, one exit worker observes command exit without reaping, kills its process group, retires numeric signaling, verifies no live members within 2 seconds, then reaps and drains output. The unreaped root pins its PID through cleanup. Child cleanup preserves shell exit codes; only confirmed Stop termination means cancellation. Stop, input failure, the 30-minute limit and Service shutdown share this worker. Unconfirmed cleanup reports a runtime error and retains workload admission. Settlement stops the watchdog.

Long-lived commands stay foreground under the yielded process ID. Backgrounding and `nohup` cannot transfer ownership; escaping the PTY group/session is unsupported. Independent services need a managed lifecycle; previews use the managed browser. Names, CPU use and age never establish ownership.

`terminal.read` observes output after the caller's sequence for up to 60 seconds, returning early on output/exit. An expired observation retains process ID and cursor and reports `wait_expired`/`wait_ms`; `timed_out` means command timeout. Continue with the same ID and returned `last_seq`, without sleeps or command restarts.

Normal expiry uses Floret `BoundedWait`; Floret measures handler time and owns repeat protection. Immediate, failed, canceled and early reads gain no exemption, nor do neighboring repeated effects. No extra retry counter, clock, wake or durable ledger exists.

Reads are read-only effects: cancellation preserves process and cursor, then confirms the canceled result after observation returns. Execution/input retain shell-effect uncertainty rules. `terminal.write` bounds stdin; `terminal.terminate` kills the owned group and waits for reap/output drain. Thread Stop policy governs cleanup.

Read results contain incremental output, status, cursor, wait and exit facts. Command, cwd and timing remain in canonical Activity without repeated model echoes.

Browser payloads exclude local working paths, stdin, authorization proofs, and effect internals.

Completion Activity uses a separate preview selected from whole UTF-8 output chunks
within the 8,000-byte presentation budget. The full retained chunk sequence is
sealed independently. Preview truncation and sequence watermarks describe exactly
the bytes shown; completion omits command/cwd already owned by the invocation.
A persistence failure is logged immediately with bounded execution identities
and remains an error at shutdown; it never triggers effect replay.

# Boundaries

No authority barriers, admission receipts, recovery handles or projection-cursor waits exist. Reads never retry settlement. Open-detail polling refreshes bytes, never canonical status or provider dispatch.

# Evidence

- [Local tool feedback](../../internal/ai/local_tool_feedback_test.go) covers default, single-field, equivalent, symlink and conflicting directories through dispatch. [Service acceptance](../../internal/ai/local_tool_feedback_integration_test.go) verifies rejection before effects, explicit correction with a real PTY, HTTP tool output, canonical Activity and restart without replay, using published Floret and isolated synthetic providers.

- `redeven:internal/ai/floret_effect_authorization.go` - Source.

- [Terminal wait integration](../../internal/ai/terminal_wait_floret_integration_test.go) - Exercises quiet repeated reads and mixed-effect repeat protection against published Floret.

- [Terminal cleanup tests](../../internal/ai/terminal_process_cleanup_unix_test.go) - Exercise ignored-HUP children, preserved exit codes, Stop/Close/cancellation/timeouts/input failures, pinned root identity, cleanup failure admission, and unrelated-process isolation.
