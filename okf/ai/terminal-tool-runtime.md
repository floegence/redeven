---
type: AI Tool Contract
title: AI terminal tool runtime
description: Redeven PTY resources with Floret v7 canonical effect and Activity ownership.
tags: [ai, terminal, tools, runtime]
timestamp: 2026-08-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven owns PTY process resources and bounded output retention. Floret v7 owns the canonical tool call, interaction, effect attempt, result, and Activity. One effect adapter authorizes execution once and publishes stable current-view updates; Redeven does not persist a parallel terminal lifecycle or recover effects from product SQL.

# Contract

Each local PTY uses Floret's execution and effect identities. `terminal.exec` waits 5 seconds by default (`yield_ms` omitted or zero), or a positive value capped at 30 seconds. When waiting ends, it returns a running process ID and the command continues.

On macOS/Linux, the PTY manager observes direct-command exit without reaping it, signals the owned process group, retires numeric group signaling, confirms the group has no running members within a bounded cleanup window, and only then reaps the root and settles output. Keeping the root unreaped pins its PID through the final group signal. Normal shell exit codes remain authoritative; cleaning up children does not itself mean cancellation. Stop, initial-input failure, the 30-minute runtime limit, and Service shutdown use the same exit worker. Cleanup failures surface as terminal runtime failures and retain workload admission; completed commands stop their watchdog immediately.

Long-lived commands must remain in the foreground and use the yielded process ID. Shell backgrounding and `nohup` do not transfer ownership to an independent service. Descendants that deliberately create another process group/session are unsupported: this is process-group cleanup, not arbitrary daemon containment. Use an explicit managed service lifecycle for independent services and the managed browser for browser previews; never infer ownership from process names, CPU usage, or age.

`terminal.read` waits up to 60 seconds for output after the caller's sequence and returns early on output or exit. One cancellable observation owns the deadline. An empty full-window result keeps the running process ID and cursor unchanged and reports `wait_expired` with `wait_ms`. These describe the read window; `timed_out` remains a command execution timeout. The model uses the same process ID and returned `last_seq` when more output or the command's final result is needed, without sleeps or command restarts.

The adapter passes a normally expired observation to the published Floret `BoundedWait` contract. Floret measures actual handler time and owns repeat protection. Immediate, failed, canceled, and early-returning reads receive no wait exemption; a wait never excuses a neighboring repeated effect. No additional retry counter, progress clock, automatic wake, or durable task ledger is introduced.

Terminal reads declare a read-only effect over the existing process. Cancellation interrupts the read without terminating the observed process or advancing its output cursor; after the local observation returns, its canceled result is confirmed for Floret settlement. Command execution and input retain their shell-effect and uncertainty rules. `terminal.write` writes bounded stdin; `terminal.terminate` explicitly requests owned-process-group termination and waits for reap and output drain. Existing thread Stop policy remains authoritative over process cleanup.

Model read results retain incremental output, status, cursor, wait facts, and exit information. The command, working directory, and process timing remain available to the canonical Activity source without being echoed into every model read result.

Browser payloads exclude local working paths, stdin, authorization proofs, and effect internals.

# Boundaries

Redeven does not wait on authority barriers, admission receipts, recovery handles, or projection cursors. Terminal reads never trigger settlement retries. UI polling may refresh process bytes while a detail row is open, but it cannot synthesize canonical status or cause provider dispatch.

# Evidence

- `redeven:internal/ai/floret_effect_authorization.go` - Binds one-shot effect authorization to the exact Floret attempt.

- `redeven:internal/ai/terminal_process.go` - Owns bounded PTY resources, output, reap, and termination.

- `redeven:internal/ai/runtime_lifecycle_admission.go:1` - Admits and releases AI turn and terminal process workloads at their canonical lifecycle boundaries.

- [Terminal wait integration](../../internal/ai/terminal_wait_floret_integration_test.go) - Exercises quiet repeated reads and mixed-effect repeat protection against published Floret.

- [Terminal observation tests](../../internal/ai/terminal_process_wait_test.go) - Verify cancellation, independent readers, early returns, unchanged cursors, and concise model output.

- [Terminal cleanup tests](../../internal/ai/terminal_process_cleanup_unix_test.go) - Exercise ignored-HUP children, preserved exit codes, Stop/Close/cancellation/timeouts/input failures, pinned root identity, cleanup failure admission, and unrelated-process isolation.
