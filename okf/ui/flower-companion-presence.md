---
type: UI Contract
title: Flower companion presence, composer and motion
tags: [ui, flower, companion, presence, floret]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Collapsed Flower projects canonical work and connection-local editor intent through one retained textarea. Priority decides whether to show a decision, draft, status target or inspection. Shared shell motion preserves draft, selection, IME and focus; historical completion never becomes new feedback.

# Contract

## Presence
### Status and live output
Canonical priority is running, queued, attention, unread failure, unread cancellation, unread completion, unavailable, idle. Reduced motion disables flow/tracking/arrival effects while retaining semantic text/color. Live tails use matching current-run facts without exposing raw thinking. A collapsed Activity companion uses stable localized status and thread-title copy for running work; it does not render continuously changing assistant output or live-tail motion. Expanded and full Flower presentations retain live progress.

### Completion acknowledgement
Only a matching successful run previously observed running while collapsed may temporarily replace an idle editor with localized completion feedback. Exclude history, queued-only work, failures, cancellation, attention, expired/mismatched runs and completion while other running/queued work remains. Feedback is ephemeral, not canonical presence.

### Observation and transport
Use the shared workspace SSE; summaries cannot invent personal read state. Expansion requests current selected detail without a second stream; disconnect uses existing recovery.

### Composer precedence
One derived entry owns rendering/target, in this order:
1. Current-thread pending decision, regardless of question type or draft.
2. Ordinary editor for draft, attachment, reference, focus or IME; inspection if editing unavailable.
3. Eligible running, queued, unread-failure or ephemeral-completion target button.
4. Ordinary editor or read-only/unavailable inspection.

## Composer
Settings recovery stays inside the collapsed row, with a reachable Retry and unchanged height. It replaces compact summary copy until recovery; active Stop remains available. The published shell cannot clip recovery outside its bounds. Expanded recovery uses the existing floating notice stack.

### Retained editor and explicit entry
The same ordinary editor moves between compact/detail presentations. Specialized decisions retain separate controls; input/approval/work priority follows [presence](#presence), never converts a decision/status entry into an editor.

### Editor layout and growth
Toolbar left stays empty; permission/model/reasoning remain in More during loading/errors. Recovery/guidance sit above the editor. Short input leaves no blank space beneath the toolbar; multiline growth moves it without replacing the editor. Dedicated pages retain complete starter suggestions.

### Motion and surface treatment
One shell grows upward/outward in width and height, preserving bottom edge, border, background and clipping. Close dissolves detail before compact layout; reversal follows current phase. Exit keeps fixed coordinates and Activity height, without origin flashes. Published forced-color and focus indicators remain. Composer disclosures follow [shared surface material](surface-material.md): portaled nested menus retain More ownership, Escape returns focus one level at a time, and exits stop accepting input immediately. Collapsed content uses only its compact composer inset; transcript/activity gutters apply to expanded content and cannot push the entry icon away from the left edge.

# Boundaries

Presence is a read-only projection of canonical work and local composer intent. Placement and focus remain owned by the Activity companion contract; transport recovery remains owned by the shared Flower runtime boundary.

This concept owns content presentation only. [Flower companion presence](#presence) remains the owner of status precedence and workspace observation.

# Evidence

- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/activityFlowerSummary.ts` - Collapsed versus expanded summary projection.
