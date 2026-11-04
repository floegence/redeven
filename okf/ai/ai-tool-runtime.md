---
type: AI Tool Contract
title: AI tool runtime and canonical interaction ownership
tags: [ai, tools, runtime, floret]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Redeven supplies typed product tools, policies, effects and presentation; Floret owns invocation, irreversible intent, approvals and admitted history. Browser state cannot authorize or settle execution. Canonical terminal views control release, and persistence failure retains unresolved interactions rather than inventing success.

# Contract

## Runtime
Floret renders reference display content and snapshots into canonical model history for execution and compaction, preserving order across follow-ups.

Lease release follows the canonical terminal view, not the HTTP response or Desktop connection lifetime, so an existing session cannot admit hidden work after the final lifecycle snapshot.

## Interactions
Resolve commits before publication; pending interaction/active projection publish atomically and waiting clears run_progress. Persistence failure stays unresolved; rejection/cancellation is row-local, never global failure.

Each interaction has one stable identity and belongs to one thread and tool call or input request.

Canonical effect intent is written before an irreversible operation.

Redeven handlers return the typed terminal current view without waiting for provider continuation, receipt observation, authority release, or a legacy local handler.

# Boundaries

Redeven must consume published Floret releases and must not persist a second copy of Floret-owned conversation, tool, approval, todo, context, projection, or provider state. Tool and execution provenance must come from explicit contracts and results rather than inference.

Floret owns canonical interaction identity, atomic answer settlement, effect-attempt state, cancellation, and unknown-outcome termination. Browser interaction state is presentation only and cannot authorize, settle, or replay an effect.

# Evidence

- `redeven:internal/ai/tools/registry.go:98` - Source.
- `redeven:internal/ai/tools/types.go:126` - Source.

- `redeven:go.mod` - Pins the published Floret dependency.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces published-v7 adoption without local replacement.
