---
type: AI Tool Contract
title: AI terminal tool runtime
description: Redeven PTY resources with Floret v7 canonical effect and Activity ownership.
tags: [ai, terminal, tools, runtime]
timestamp: 2026-08-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns PTY process resources and bounded output retention. Floret v7 owns the canonical tool call, interaction, effect attempt, result, and Activity. One effect adapter authorizes execution once and publishes stable current-view updates; Redeven does not persist a parallel terminal lifecycle or recover effects from product SQL.

# Contract

`terminal.exec` starts a local PTY after the Floret invocation provides the exact thread, turn, run, tool-call, and effect-attempt identity.

`terminal.read` returns output after the caller's sequence, `terminal.write` writes bounded stdin, and `terminal.terminate` requests process-tree termination and waits for reap and output drain.

Browser payloads exclude local working paths, stdin, authorization proofs, and effect internals.

# Boundaries

Redeven does not wait on authority barriers, admission receipts, recovery handles, or projection cursors. Terminal reads never trigger settlement retries. UI polling may refresh process bytes while a detail row is open, but it cannot synthesize canonical status or cause provider dispatch.

# Evidence

- `redeven:internal/ai/floret_effect_authorization.go` - Binds one-shot effect authorization to the exact Floret attempt.

- `redeven:internal/ai/terminal_process.go` - Owns bounded PTY resources, output, reap, and termination.

- `redeven:internal/ai/runtime_lifecycle_admission.go:1` - Admits and releases AI turn and terminal process workloads at their canonical lifecycle boundaries.
