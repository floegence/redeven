---
type: UI Contract
title: Flower companion presence
description: Project canonical Flower work into the compact companion without displacing drafts, stealing focus, or creating another lifecycle owner.
tags: [ui, flower, companion, presence, floret]
timestamp: 2026-10-12T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven projects canonical Floret summaries and matching current-run detail into one compact Flower status. Active work, pending actions, and user-owned drafts retain explicit precedence; historical completion never masquerades as new feedback. Presence shares the existing workspace stream and does not auto-expand, claim transcript reads, or recreate thread lifecycle state. A disconnect follows the existing transport refresh contract. [Flower Activity companion](flower-activity-companion.md) owns placement, native composer identity, dismissal, and read acknowledgement.

# Contract

## Status and live output
Floating companion presence is a pure canonical summary projection with active work first: running, queued, attention, unread failure, unread canceled, unread completed, unavailable, idle.

Reduced motion disables flow, transition tracking, and arrival motion while retaining semantic color and text.

## Completion acknowledgement
A successful transition for a run that the collapsed companion previously observed as running may temporarily replace the idle composer with one localized completion acknowledgement. This is ephemeral product feedback, not canonical completed presence: initial history, queued-only work, failures, cancellations, attention, mismatched or expired runs, and completion while any running or queued work remains never trigger it. Historical completion remains forbidden from the collapsed companion.

## Observation and transport
The companion consumes the same single workspace SSE as the full Flower surface. Shared summaries never manufacture personal read state.

Expansion keeps the same connection and requests the selected thread current view rather than creating a second stream.

## Composer precedence
One derived entry description owns collapsed rendering and target identity.

- The current thread's pending decision entry, regardless of question kind, selected option, custom-answer mode, or draft content. - The ordinary chat editor when a draft, attachment, reference, focus, or IME session is present; an enabled inspection entry preserves access if editing is unavailable. - An eligible running, queued, unread-failure, or ephemeral-completion status button with its exact target thread. - The ordinary editor, or an inspection entry for a read-only or unavailable editor.

[Flower Activity companion](flower-activity-companion.md) owns public question copy, activation, and one-shot focus handoffs.

# Boundaries

Presence is a read-only projection of canonical work and local composer intent. Placement and focus remain owned by the Activity companion contract; transport recovery remains owned by the shared Flower runtime boundary.

# Evidence

- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts` - canonical thread summaries produce mutually exclusive priority groups and fallback-preserving title selection.

- `redeven:internal/flower_ui/src/flowerCompanionLiveTail.ts` - active-run blocks project waiting/thinking status, compact tool presentation, or latest assistant output without exposing raw thinking.

- `redeven:internal/flower_ui/src/flowerCompanionRunTracker.ts` - accepted typed current views bind exact active RunIDs to process-local generations and emit matching terminal receipts.
