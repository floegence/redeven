---
type: AI Runtime Contract
title: Floret thread runtime integration
tags: [ai, floret, threads, runtime]
quality_exception: Typed Floret ThreadService lifecycle and restart contract covering canonical journal ownership, idempotent effects, and migration safety.
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Floret v7 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven authorizes endpoint ownership, resolves attachments and maps provider/tool effects. Send, Respond, Cancel, Retry, and the optional independent CompactContext return typed state before continuation. Canonical records prevent duplicates; drafts and execution tokens remain transient.

# Contract

## Typed runtime
Optional ThreadGoalController and WithAgentGoals provide [canonical Goals](flower-goals.md).

Redeven-specific authorization, DTO mapping, live projection, and adapter ownership are specified in [Floret Redeven adapter and projection](floret-redeven-adapter-and-projection.md).

## Automatic display preparation

Floret owns one-time historical source preparation during upgrade. Redeven publishes service readiness without a global display-preparation sweep and observes public per-thread readiness; it never scans or migrates Floret-owned records. Prepared restarts reuse canonical readiness anchors. Hidden Activity field indexes are prepared only on explicit detail reads.
New threads and independently ready conversations remain available while other
threads prepare; a failed preparation is reported without rewriting history.

## Identical consecutive tool calls

Published Floret v7.98.0 owns one sequence of individual calls, including
provider-hosted tools. Only the same tool and all identical arguments count;
descriptions remain significant. JSON object order and formatting are normalized
without losing numeric precision, string contents, array order or value types.
A different call or hosted invocation resets the sequence. Alternating batches
are not consecutive identical calls. Call IDs, streaming fragments and transport
retries add no calls. Completed bounded waits and changed polling tokens retain
their upstream exemptions; Redeven does not exclude description fields.

At the configured limit, Floret rejects before authorization/execution and
persists a paired, explicit non-execution result. The model receives one decision
to adjust or summarize; continuing unchanged stops the turn. Admitted child
events reset the sequence at the next request boundary. Confirmed sibling
results and completed reports survive failure, restart and explicit Retry.
No product polling heuristic, automatic replay or child restart is added.

# Boundaries

Redeven never imports Floret internals, reads Floret storage, copies canonical lifecycle into product SQL, or uses sibling source wiring in formal validation. Product migrations may import retired queued inputs once into the typed runtime and then delete their staging rows.

# Evidence

- `redeven:go.mod` - Pins the released Floret typed runtime without local replacement.

- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects retired imports.

- `redeven:internal/ai/terminal_wait_floret_integration_test.go` - Published polling, descriptions, alternation and cancellation.
- `redeven:internal/ai/strict_repetition_integration_test.go` - Model-visible feedback and user-visible diagnostics over the released runtime.
