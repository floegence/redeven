---
type: UI Contract
title: Flower timeline ordering
description: Canonical typed views, separate submission feedback, and stable row identity.
tags: [ui, flower, timeline, ordering]
timestamp: 2026-10-14T00:00:00Z
---
# Summary

Flower renders the ordered items in Floret's typed current view. Canonical stable IDs plus each item's exact TurnID and RunID determine user, assistant, tool, interaction, queue, and terminal rows. Ordinary unconfirmed input remains in the composer with Send button loading. A short-lived transport outbox shows queued submissions only in the queue dock; matching canonical request-key confirmation updates that same row without duplicating the transcript. Summaries never write timeline detail.

# Contract

Floret canonical journal order is authoritative for durable rows. Current-process assistant and thinking drafts arrive only inside the typed current view and disappear when canonical terminal output replaces them. Repeated provider attempts use the same stable output identity, so late or duplicate completion cannot append a second assistant or tool row.

Thinking is presentation state over the same canonical current view. While a thinking block is live, Flower shows a tail-following preview capped at four visual lines and fades its older prefix; the user may expand the complete accumulated text. Each segment closes when its canonical live flag ends normally, including a manually expanded segment, without waiting for turn completion. Failure, interruption or cancellation for the same thread, turn and run preserves the current view; a later run in the same turn cannot supply that exception. Already closed segments stay closed. Connection confirmation controls tail following only; disconnect is not segment completion. Completed history starts closed with the neutral localized Thought process heading, and manual reopening survives repeated detail updates. Closing content returns its interior focus to the thinking button. The inner thinking choice does not control whole-turn disclosure. Whole-turn disclosure and reading protection follow [Flower terminal turn process disclosure](flower-turn-process-disclosure.md), without changing message order, live transport ownership or persisted content.

The thinking disclosure chevron points right when collapsed and down whenever content is visible, including the live preview and full expansion. Its direction follows the same open state exposed by the button's `aria-expanded` attribute across full, embedded and child-detail timelines.

Queued input is canonical Floret state and appears exactly once in the queue lane. Admission may produce a user row or canonical queue item. Local queue feedback is static Waiting to queue until that admission, and never determines the canonical result. Flower never guesses ordering from timestamps, prompt equality, or a local operation reducer.

ThreadCache accepts detail only from detail GET and LiveCurrent after the complete timeline validates. It rejects missing or conflicting execution identity and an older view version, and retains cached A and B views across A-to-B-to-A selection. One coordinator deduplicates a cold selection with summary-driven loading, coalesces an advancing summary to one latest request, and never retries a failed revision without a new display cycle or explicit user action. Summary refresh, disconnect, hidden-page recovery, and slow responses cannot clear messages. Cancel and Reject update the corresponding turn or tool row without a global failure card.

# Boundaries

Stable row identity and order come only from the published Floret current view. The outbox, cache, live transport, renderer keys, and summaries may present or temporarily confirm those rows but cannot assign a canonical item ID, ordinal, queue identity, terminal state, or lower `ViewVersion`.

# Evidence

- `redeven:go.mod` - Pins the published Floret current-item identity and turn presentation contract.
- `redeven:internal/ai/floret_timeline_messages_test.go` - Proves Redeven preserves public ordered items and live markers from the typed view.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Current-view projection.
- `redeven:internal/flower_ui/src/threadCache.ts` - Versioned bounded detail cache.
- `redeven:internal/flower_ui/src/transportOutbox.ts` - Request-ID confirmation and deduplication.
- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - Stable row projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.test.ts` - Covers explicit live state and canonical lifecycle projection.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.thinkingDisclosure.browser.test.tsx` - Rendered chevron direction, segment sealing during active turns, reconnect, exact run ownership, child state and narrow keyboard behavior.
- `redeven:internal/envapp/ui_src/src/ui/flower/FlowerThinkingDisclosure.test.tsx` - Independent view transitions, abnormal retention and focus return.
