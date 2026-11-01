---
type: UI Contract
title: Flower companion presence
tags: [ui, flower, companion, presence, floret]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Collapsed Flower projects canonical summaries and current-run detail through the existing workspace stream. Work, pending decisions and drafts have explicit precedence; historical completion is never new feedback. Presence neither expands Flower nor acknowledges reads. [Activity companion](flower-activity-companion.md) owns placement, focus and dismissal.

# Contract

## Status and live output
Canonical priority is running, queued, attention, unread failure, unread cancellation, unread completion, unavailable, idle. Reduced motion disables flow/tracking/arrival effects while retaining semantic text/color. Live tails use matching current-run facts without exposing raw thinking.

## Completion acknowledgement
Only a matching successful run previously observed running while collapsed may temporarily replace an idle editor with localized completion feedback. Exclude history, queued-only work, failures, cancellation, attention, expired/mismatched runs and completion while other running/queued work remains. Feedback is ephemeral, not canonical presence.

## Observation and transport
Use the shared workspace SSE; summaries cannot invent personal read state. Expansion requests current selected detail without a second stream; disconnect uses existing recovery.

## Composer precedence
One derived entry owns rendering/target, in this order:
1. Current-thread pending decision, regardless of question type or draft.
2. Ordinary editor for draft, attachment, reference, focus or IME; inspection if editing unavailable.
3. Eligible running, queued, unread-failure or ephemeral-completion target button.
4. Ordinary editor or read-only/unavailable inspection.

[Activity companion](flower-activity-companion.md) owns question activation and one-shot focus handoffs.

# Boundaries

Presence is a read-only projection of canonical work and local composer intent. Placement and focus remain owned by the Activity companion contract; transport recovery remains owned by the shared Flower runtime boundary.

# Evidence

- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts` - Canonical mutually exclusive priority groups with title fallback.

- `redeven:internal/flower_ui/src/flowerCompanionLiveTail.ts` - Canonical waiting/thinking/tool/output projection without raw thinking.
