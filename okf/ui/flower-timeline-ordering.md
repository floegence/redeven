---
type: UI Contract
title: Flower timeline ordering
tags: [ui, flower, timeline, ordering]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower renders Floret ordered facts using stable item, TurnID and RunID identities. Captured ordinary input appears immediately; only that draft is consumed. Queued inputs stay in the dock. Canonical request-key confirmation preserves mounted rows without duplicates, and summaries never author timeline detail.

# Contract

Canonical source order comes from published Floret v7.61.0 canonical_ordinal on public items and parent events.

Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Boundaries

Stable row identity and order come only from the published Floret current view. Pending user presentation derives its stable key from the submitted request ID but does not assert admission. The outbox, cache, transport and renderer cannot invent canonical TurnID, RunID, ordinal, queue membership or terminal state, or lower ViewVersion.

# Evidence

- `redeven:go.mod` - Published current-item/turn presentation contract.

- `redeven:internal/ai/floret_timeline_messages_test.go` - Public ordered items and live markers preserved in projection.
