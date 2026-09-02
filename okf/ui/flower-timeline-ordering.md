---
type: UI Contract
title: Flower timeline ordering
description: Canonical typed views, optimistic transport input, and stable row identity.
tags: [ui, flower, timeline, ordering]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Flower renders the ordered items in Floret's typed current view. Canonical stable IDs plus each item's exact TurnID and RunID determine user, assistant, tool, interaction, queue, and terminal rows. A short-lived transport outbox may show an unconfirmed user input at its final transcript position, but matching request-key confirmation atomically replaces it with the canonical row. Summaries never write timeline detail.

# Contract

Floret canonical journal order is authoritative for durable rows. Current-process assistant and thinking drafts arrive only inside the typed current view and disappear when canonical terminal output replaces them. Repeated provider attempts use the same stable output identity, so late or duplicate completion cannot append a second assistant or tool row.

Queued input is canonical Floret state and appears exactly once in the queue lane. An idle Send appears as the user row; a busy Send appears directly in the queue. Flower never guesses ordering from timestamps, prompt equality, or a local operation reducer.

ThreadCache accepts detail only from detail GET and LiveCurrent after the complete timeline validates. It rejects missing or conflicting execution identity and an older view version, and retains cached A and B views across A-to-B-to-A selection. One coordinator deduplicates a cold selection with summary-driven loading, coalesces an advancing summary to one latest request, and never retries a failed revision without a new display cycle or explicit user action. Summary refresh, disconnect, hidden-page recovery, and slow responses cannot clear messages. Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Boundaries

Stable row identity and order come only from the published Floret current view. The outbox, cache, live transport, renderer keys, and summaries may present or temporarily confirm those rows but cannot assign a canonical item ID, ordinal, queue identity, terminal state, or lower `ViewVersion`.

# Evidence

- `redeven:go.mod` - Pins the published Floret v7.1.0 exact current-item identity contract.
- `redeven:internal/ai/floret_timeline_messages_test.go` - Proves Redeven preserves public ordered items and live markers from the typed view.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Current-view projection.
- `redeven:internal/flower_ui/src/threadCache.ts` - Versioned bounded detail cache.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Request-ID confirmation and deduplication.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Stable row projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.test.ts` - Covers explicit live state and canonical lifecycle projection.
