---
type: UI Contract
title: Flower timeline ordering
description: Canonical typed views, separate submission feedback, and stable row identity.
tags: [ui, flower, timeline, ordering]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower renders the ordered items in Floret's typed current view. Canonical stable IDs plus each item's exact TurnID and RunID determine user, assistant, tool, interaction, queue, and terminal rows. Ordinary unconfirmed input remains in the composer with Send button loading. A short-lived transport outbox shows queued submissions only in the queue dock; matching canonical request-key confirmation updates that same row without duplicating the transcript. Summaries never write timeline detail.

# Contract

Canonical source order comes from published Floret v7.61.0 canonical_ordinal on public items and parent events.

Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Boundaries

Stable row identity and order come only from the published Floret current view. The outbox, cache, live transport, renderer keys, and summaries may present or temporarily confirm those rows but cannot assign a canonical item ID, ordinal, queue identity, terminal state, or lower `ViewVersion`.

# Evidence

- `redeven:go.mod` - Pins the published Floret current-item identity and turn presentation contract.

- `redeven:internal/ai/floret_timeline_messages_test.go` - Proves Redeven preserves public ordered items and live markers from the typed view.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Current-view projection.
