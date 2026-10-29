---
type: AI Runtime Contract
title: AI tool approval and interaction runtime
tags: [ai, tools, approvals, flower]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret owns typed approval/input; Redeven authorizes and renders without a second lifecycle. Resolve commits canonical results before view publication. Since v7.26.0, unresolved interaction and active projection publish atomically; waiting clears run_progress, other active summaries retain it. Persistence failure stays unresolved; reject/cancel is row-local, not a global failure.

# Contract

Each interaction has one stable identity and belongs to one thread and tool call or input request.

Canonical effect intent is written before an irreversible operation.

Redeven handlers return the typed terminal current view without waiting for provider continuation, receipt observation, authority release, or a legacy local handler.

# Boundaries

Floret owns canonical interaction identity, atomic answer settlement, effect-attempt state, cancellation, and unknown-outcome termination. Browser interaction state is presentation only and cannot authorize, settle, or replay an effect.

# Evidence

- `redeven:go.mod` - Pins the released Floret v7.26.0 typed runtime.

- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces published-v7 adoption without local replacement.
