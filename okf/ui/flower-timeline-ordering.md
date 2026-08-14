---
type: UI Contract
title: Flower timeline ordering
description: Canonical typed views, optimistic transport input, and stable row identity.
tags: [ui, flower, timeline, ordering]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Flower renders the ordered items in Floret's typed current view. Canonical stable IDs determine user, assistant, tool, interaction, queue, and terminal rows. A short-lived transport outbox may show an unconfirmed user input at its final transcript position, but canonical confirmation removes it instead of moving or duplicating it. Summaries never write timeline detail.

# Contract

Floret canonical journal order is authoritative for durable rows. Current-process assistant and thinking drafts arrive only inside the typed current view and disappear when canonical terminal output replaces them. Repeated provider attempts use the same stable output identity, so late or duplicate completion cannot append a second assistant or tool row.

Queued input is canonical Floret state and appears exactly once in the queue lane. An idle Send appears as the user row; a busy Send appears directly in the queue. Flower never guesses ordering from timestamps, prompt equality, or a local operation reducer.

ThreadCache accepts detail only from detail GET and LiveCurrent. It rejects an older view version and retains cached A and B views across A-to-B-to-A selection. Summary refresh, disconnect, hidden-page recovery, and slow responses cannot clear messages. Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Evidence

- `floret:runtime/thread_runtime.go` - Typed current view and stable queue/item identities.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Current-view projection.
- `redeven:internal/flower_ui/src/threadCache.ts` - Versioned bounded detail cache.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Request-ID confirmation and deduplication.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Stable row projection.
