---
type: AI Runtime Contract
title: Floret thread runtime integration
tags: [ai, floret, threads, runtime]
quality_exception: Typed Floret ThreadService lifecycle and restart contract covering canonical journal ownership, idempotent effects, and migration safety.
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Floret v7 ThreadService alone owns active/canonical lifecycle. Redeven authorizes endpoints/resources/provider-tool effects. Send/Respond/Cancel/Retry/CompactContext return typed state before continuation. Floret owns one-time historical source preparation during upgrade.

# Contract

## Typed runtime
Optional ThreadGoalController and WithAgentGoals provide [canonical Goals](flower-goals.md).

Redeven-specific authorization, DTO mapping, live projection, and adapter ownership are specified in [Floret Redeven adapter and projection](floret-redeven-adapter-and-projection.md).

## Automatic display preparation

Redeven publishes service readiness without a global display-preparation sweep and observes public per-thread readiness; it never scans or migrates Floret-owned records. Prepared restarts reuse canonical readiness anchors. Hidden Activity field indexes are prepared only on explicit detail reads. New threads and independently ready conversations remain available while other
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

- `redeven:go.mod` - Source.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects retired imports.

Published Floret v7.107.5 owns the schema-36 activity-membership preparation fence. Pending membership applies only to tool records, even when thinking and tools share a source identifier. Released schema-35 manifests rebuild from canonical source without rewriting conversation records. Cold bounded reads, full View, Send, Retry, Fork and restart are qualified using an immutable synthetic released-writer fixture. Redeven never repairs upstream domain records; residual authority corruption is an explicit per-thread unavailable summary, not a fabricated healthy view or global transport failure.
