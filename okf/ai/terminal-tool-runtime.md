---
type: AI Tool Contract
title: AI terminal tool runtime
description: Redeven PTY resources with Floret v4 canonical effect and Activity ownership.
tags: [ai, terminal, tools, runtime]
timestamp: 2026-08-15T00:00:00Z
---
# Summary

Redeven owns PTY process resources and bounded output retention. Floret v4 owns the canonical tool call, interaction, effect attempt, result, and Activity. One effect adapter authorizes execution once and publishes stable current-view updates; Redeven does not persist a parallel terminal lifecycle or recover effects from product SQL.

# Contract

`terminal.exec` starts a local PTY after the Floret invocation provides the exact thread, turn, tool-call, and effect-attempt identity. Before spawning, it acquires a protected Runtime lifecycle workload lease for that exact hosted process; a closed lifecycle admission rejects the process without changing manager state. The lease remains held through process reap and output drain and is released exactly once from the real process terminal path. Redeven publishes the public process id and sanitized shell presentation through the invocation Activity update. Provider and tool I/O run outside the ThreadRuntime lock. Only the minimal irreversible tool intent fence is durable before process creation; a result whose side effect is uncertain is not automatically replayed.

The process manager retains monotonic output chunks with fixed byte limits. `terminal.read` returns output after the caller's sequence, `terminal.write` writes bounded stdin, and `terminal.terminate` requests process-tree termination and waits for reap and output drain. These process operations do not invent canonical Activity state. The effect adapter settles the exact Floret effect attempt once; duplicate or late completion cannot append a second canonical tool result.

Tool approval is a typed Floret interaction. Accept continues only the matching effect; reject resolves that interaction and renders the outcome on the tool row without a global model failure. Cancel terminates active process resources and asks Floret to cancel the thread turn idempotently. Runtime restart resumes only canonically safe input and queue work; an uncertain terminal side effect remains on its tool row with an explicit Retry Effect action.

Presentation is derived from the typed Floret Activity payload. A parseable but schema-invalid call may retain sanitized command presentation, but it fails before authorization or PTY creation. Browser payloads exclude local working paths, stdin, authorization proofs, and effect internals.

# Boundaries

Redeven does not wait on authority barriers, admission receipts, recovery handles, or projection cursors. Terminal reads never trigger settlement retries. UI polling may refresh process bytes while a detail row is open, but it cannot synthesize canonical status or cause provider dispatch.

# Evidence

- `redeven:internal/ai/floret_effect_authorization.go` - Binds one-shot effect authorization to the exact Floret attempt.
- `redeven:internal/ai/terminal_process.go` - Owns bounded PTY resources, output, reap, and termination.
- `redeven:internal/ai/runtime_lifecycle_admission_test.go` - Proves post-fence rejection and release only after canonical turn or process terminal state.
- `redeven:internal/ai/terminal_process_service.go` - Adapts process completion to the canonical effect result.
- `redeven:internal/ai/builtin_tool_handlers.go` - Declares terminal schemas and safe presentation.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Maps typed Activity presentation into the Shell row.
