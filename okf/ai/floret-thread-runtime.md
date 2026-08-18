---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Typed Floret v4 thread runtime ownership and Redeven product boundaries.
tags: [ai, floret, threads, runtime]
timestamp: 2026-08-18T00:00:00Z
---
# Summary

Floret v4 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven owns endpoint authorization, attachment resource resolution, provider and tool effects, and browser-safe mapping. Every existing-thread mutation proves that the ThreadID belongs to the authenticated endpoint before entering Floret. Send, Respond, Cancel, Retry, and RetryEffect return the current typed view without waiting for provider continuation. Canonical journal facts prevent duplicate user, assistant, tool, and interaction records; transient drafts and execution tokens remain in memory.

# Contract

## Typed runtime

One `ThreadRuntime` plus mutex owns each active thread. Provider and tool I/O run outside that mutex and return through a stable execution token; late results for a replaced or canceled token are ignored. The public boundary is typed `Create`, `Fork`, `Delete`, `View`, `Send`, `Respond`, `Cancel`, `Retry`, `RetryEffect`, queue mutation, and workspace `Subscribe`. There is no public generic command receipt, event replay cursor, execution handle, or projection delta.

`Send` validates a stable `(thread_id, request_key)` and completes canonical turn acceptance before returning or publishing the user segment. Acceptance failure leaves the in-memory view unchanged; provider work starts asynchronously only after the accepted receipt. The canonical journal is the only durable lifecycle fact source. Unique request, turn, tool-call, effect-attempt, and terminal keys make repeated provider dispatch safe without duplicating the visible timeline. Irreversible effects alone require a minimal durable intent before dispatch; an unknown effect outcome is never replayed automatically and exposes RetryEffect on the original tool row.

Queue admission and mutation, `Respond`, and `Cancel` commit their minimum
canonical fact before publishing success. `Respond` resolves the exact pending
interaction, including one atomic Answers batch for Reject All. `Cancel` is
idempotent for every known thread, clears pending interactions, cancels active
execution, and produces at most one terminal cancellation. `Retry` preserves
logical request lineage without appending another user message. `RetryEffect`
claims the stable unknown source once before any irreversible handler dispatch.
Delete and shutdown fence new effect work, cancel and join the active subtree,
and prevent late output from outranking a tombstone.

Restart hydration restores accepted input, queue items, unresolved interactions,
retry-specific input, and canonical outputs, then resumes provider-safe work
from the last canonical boundary. Unknown effects remain unresolved. Floret owns
the permanent domain migration lineage from v2 through v5; migration, logical
version update, and final verification commit in one backend transaction, while
current canonical bytes remain unchanged.

Child agents are ordinary child threads with parent identity and independent runtime ownership. No product-owned SubAgent lifecycle, recovery handle, or publication state may become a second authority.

The first accepted canonical user message and its fallback title commit in the
same Floret boundary. Pending or failed automatic-title work keeps that
fallback; provider success or an explicit host rename is the only replacement.
Fallback title truncation remains whitespace-normalized and trim-stable at the
canonical length boundary, so a long first message cannot invalidate otherwise
healthy session-tree authority.
Redeven sends Floret's tool-free `thread_title` provider request through the
run lifetime admission without requiring the main turn's canonical permission
owner, because the title request cannot dispatch tools. Ordinary provider
requests, including any request with tool definitions, still require the
canonical permission snapshot before model dispatch.

## Redeven adapter

Redeven keeps one typed adapter over the published Floret v4 module. HTTP and RPC handlers perform product authorization, ResourceRef and attachment resolution, DTO mapping, and a typed call. They do not wait for provider work, register a legacy run handler, observe a receipt, acquire an authority barrier, or persist a lifecycle projection.

A dynamic `ToolSurface` with registry tools and nil provider definitions inherits
the registry definitions. A non-nil empty definitions slice intentionally exposes
no registry tools to the provider. Redeven relies on the published Floret runtime
to preserve that distinction; provider tool names that are absent from the
resolved definitions remain rejected before dispatch.

Redeven consumes Floret v4.0.12's public ordered `ThreadView.Items` and
`ThreadContextReader`. User, thinking, assistant, tool, and independent
interaction segments retain Floret-assigned IDs and ordinals across live
updates, approval settlement, canonical reload, and renderer recovery. Redeven
maps the sequence directly and does not consume the deprecated global draft
fields, infer order from timestamps or tool identity, or persist a second
presentation order.

One endpoint/thread authority boundary resolves the product catalog record and
rejects an absent, tombstoned, or foreign thread before every canonical
mutation. A shared endpoint may contain turns from multiple users, so Redeven
persists only the submitting turn's minimum host authorization and audit facts:
endpoint, namespace, channel, user, and request, turn, and thread identities.
Floret remains the owner of canonical input, attachment references, and retry
source. Restart redispatch combines those Floret facts with the matching host
authority record instead of using the thread creator, and never stores a second
transcript or lifecycle projection.

Authority is durable before pending-input import or child-thread Send can admit
canonical input. Retry and child Send then bind the same authority to the TurnID
returned by Floret using a bounded service-owned context, so caller cancellation
after acceptance cannot break restart or a later retry. Child settings preserve
autonomous execution and reviewer readonly permission across restart. SubAgent
detail reads prove parent endpoint ownership before using the process-wide
Floret child list or view.

Flower thread navigation assigns the selection generation synchronously with
the user's rail intent. Deferred presentation work carries that generation,
and an older bootstrap is rejected before it can update `ThreadCache` detail.
Rapid A to B to A navigation therefore keeps the latest selected identity and
transcript even when earlier detail requests settle out of order.

`ThreadContextReader` recovers the
canonical merged compaction operations for detail reads and terminal workspace
updates. A pure `/compact` input supplies one host-owned manual compaction request;
the canonical user message anchors exactly one terminal `compacted` or `noop`
divider after renderer reload. Context reads remain valid when `ask_user` resumes
one turn through a later canonical run. Redeven does not persist a parallel
compaction projection or inspect Floret storage.

Floret queue item `id` is the canonical mutation identity for reorder, delete,
and promote. Its `request_key` remains the send idempotency identity used only to
settle the short-lived browser outbox; the two values are not interchangeable.

# Boundaries

Redeven never imports Floret internals, reads Floret storage, copies canonical lifecycle into product SQL, or uses sibling source wiring in formal validation. Product migrations may import retired queued inputs once into the typed runtime and then delete their staging rows.

# Evidence

- `floret:runtime/thread_runtime.go` - Typed service, per-thread runtime, queue, interaction, cancellation, retry, and subscription boundary.
- `floret:internal/sessiontree/backend_repo_journal.go` - Canonical journal persistence and stable fact identity.
- `redeven:internal/ai/floret_runtime.go` - Published runtime composition.
- `redeven:internal/ai/floret_thread_context.go` - Canonical compaction mapping and timeline anchoring.
- `redeven:internal/ai/send_user_turn.go` - Thin product send mapping into typed Floret state.
- `redeven:internal/ai/threads.go` - Single endpoint/thread ownership boundary before canonical mutation.
- `redeven:internal/ai/execution_authority.go` - Current submitting-user authority capture for restart recovery.
- `redeven:internal/ai/threadstore/execution_authority.go` - Minimal host authorization facts for restart redispatch.
- `redeven:internal/ai/execution_authority_continuity_test.go` - Retry and SubAgent authority continuity across accepted turns and restart.
- `redeven:internal/ai/stop_thread.go` - Idempotent typed cancellation without handler lookup.
- `redeven:internal/ai/retry_thread_effect.go` - Exact unknown-effect retry mapping.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Latest-selection generation fence before detail cache mutation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Deterministic out-of-order A to B to A navigation coverage.
