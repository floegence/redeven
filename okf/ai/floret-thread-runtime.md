---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Typed Floret v4 thread runtime ownership and Redeven product boundaries.
tags: [ai, floret, threads, runtime]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Floret v4 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven owns product catalog authorization, attachment resource resolution, provider and tool effects, and browser-safe mapping. Send, Respond, Cancel, Retry, and RetryEffect return the current typed view without waiting for provider continuation. Canonical journal facts prevent duplicate user, assistant, tool, and interaction records; transient drafts and execution tokens remain in memory.

# Contract

## Typed runtime

One `ThreadRuntime` plus mutex owns each active thread. Provider and tool I/O run outside that mutex and return through a stable execution token; late results for a replaced or canceled token are ignored. The public boundary is typed `Create`, `Fork`, `Delete`, `View`, `Send`, `Respond`, `Cancel`, `Retry`, `RetryEffect`, queue mutation, and workspace `Subscribe`. There is no public generic command receipt, event replay cursor, execution handle, or projection delta.

`Send` validates a stable `(thread_id, request_key)`, updates the in-memory view immediately, and schedules provider work. The canonical journal is the only durable lifecycle fact source. Unique request, turn, tool-call, effect-attempt, and terminal keys make repeated provider dispatch safe without duplicating the visible timeline. Irreversible effects alone require a minimal durable intent before dispatch; an unknown effect outcome is never replayed automatically and exposes RetryEffect on the original tool row.

`Respond` resolves the exact pending interaction. `Cancel` is idempotent for every known thread, clears pending interactions, cancels active execution, and produces at most one terminal cancellation. `Retry` preserves logical request lineage without appending another user message. Restart hydration restores accepted input, queue items, unresolved interactions, and canonical outputs, then resumes provider-safe work from the last canonical boundary. Unknown effects remain unresolved.

Child agents are ordinary child threads with parent identity and independent runtime ownership. No product-owned SubAgent lifecycle, recovery handle, or publication state may become a second authority.

## Redeven adapter

Redeven keeps one typed adapter over the published Floret v4 module. HTTP and RPC handlers perform product authorization, ResourceRef and attachment resolution, DTO mapping, and a typed call. They do not wait for provider work, register a legacy run handler, observe a receipt, acquire an authority barrier, or persist a lifecycle projection.

# Boundaries

Redeven never imports Floret internals, reads Floret storage, copies canonical lifecycle into product SQL, or uses sibling source wiring in formal validation. Product migrations may import retired queued inputs once into the typed runtime and then delete their staging rows.

# Evidence

- `floret:runtime/thread_runtime.go` - Typed service, per-thread runtime, queue, interaction, cancellation, retry, and subscription boundary.
- `floret:internal/sessiontree/backend_repo_journal.go` - Canonical journal persistence and stable fact identity.
- `redeven:internal/ai/floret_runtime.go` - Published runtime composition.
- `redeven:internal/ai/send_user_turn.go` - Thin product send mapping into typed Floret state.
- `redeven:internal/ai/stop_thread.go` - Idempotent typed cancellation without handler lookup.
- `redeven:internal/ai/retry_thread_effect.go` - Exact unknown-effect retry mapping.
