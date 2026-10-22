---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Typed Floret v7 thread runtime ownership and Redeven product boundaries.
tags: [ai, floret, threads, runtime]
timestamp: 2026-10-18T00:00:00Z
quality_exception: Typed Floret ThreadService lifecycle and restart contract covering canonical journal ownership, idempotent effects, and migration safety.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret v7 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven owns endpoint authorization, attachment resource resolution, provider and tool effects, and browser-safe mapping. Every existing-thread mutation proves that the ThreadID belongs to the authenticated endpoint before entering Floret. Send, Respond, Cancel, Retry, and the optional independent CompactContext return the current typed view without waiting for provider continuation. Canonical journal facts prevent duplicate user, assistant, tool, and interaction records; transient drafts and execution tokens remain in memory.

# Contract

## Typed runtime
Optional ThreadGoalController and WithAgentGoals provide [canonical Goals](flower-goals.md).

Redeven-specific authorization, DTO mapping, live projection, and adapter ownership are specified in [Floret Redeven adapter and projection](floret-redeven-adapter-and-projection.md).

# Boundaries

Redeven never imports Floret internals, reads Floret storage, copies canonical lifecycle into product SQL, or uses sibling source wiring in formal validation. Product migrations may import retired queued inputs once into the typed runtime and then delete their staging rows.

# Evidence

- `redeven:go.mod` - Pins the released Floret v7.79.0 typed runtime without local replacement.

- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects retired imports.

- `redeven:internal/ai/floret_runtime.go` - Published runtime composition.
