---
type: UI Contract
title: Flower timeline ordering
description: Canonical typed views, separate submission feedback, and stable row identity.
tags: [ui, flower, timeline, ordering]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Flower renders the ordered items in Floret's typed current view. Canonical stable IDs plus each item's exact TurnID and RunID determine user, assistant, tool, interaction, queue, and terminal rows. Ordinary captured input appears immediately as a pending user row; only the captured draft is consumed. Queued submissions appear in the queue dock. Canonical request-key confirmation retains the corresponding mounted row without duplicating the transcript; newer drafts remain editable. Summaries never write timeline detail.

# Contract

Canonical source order comes from published Floret v7.61.0 canonical_ordinal on public items and parent events.

Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Boundaries

Stable row identity and order come only from the published Floret current view. Pending user presentation derives its stable key from the submitted request ID but does not assert admission. The outbox, cache, transport and renderer cannot invent canonical TurnID, RunID, ordinal, queue membership or terminal state, or lower ViewVersion.

# Evidence

- `redeven:go.mod` - Pins the published Floret current-item identity and turn presentation contract.

- `redeven:internal/ai/floret_timeline_messages_test.go` - Proves Redeven preserves public ordered items and live markers from the typed view.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Current-view projection.
