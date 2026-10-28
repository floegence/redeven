---
type: UI Contract
title: Flower terminal turn process disclosure
description: Collapse terminal work while preserving valuable output, explicit choices and active reading.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Floret owns turn identity, outcome, timing and explicit final boundaries. Terminal ordinary turns default closed after success, failure, cancellation or interruption; the live-to-terminal transition applies that default once. Pending controls and unresolved effects remain visible. Explicit user choices and active inspection prevent automatic collapse. Dialogue/finals stay visible. Interleaved answered inputs retain visible checkpoints between independently folded sequences.

# Contract

## Canonical facts and eligibility
Validated ThreadView/HistoryPage turn facts include exact TurnID/RunID, optional control kind, start/end, outcome, elapsed/wait/work durations, ordered intermediate/final item IDs and complete-final boundary. Summaries cannot author them or trigger collapse; unknown output remains visible.

A single thinking-only process keeps its existing thinking disclosure and timing; it never gains a redundant work-duration summary or divider on completion. Eligibility follows typed process structure, not prompt text or elapsed-time heuristics. Other process summaries show at most two nonzero time units with subsecond copy. Interleaved answers default expanded with an accessible whole-turn toggle; folding hides only process rows and preserves visible answer checkpoints and nested choices. Counts appear only when loaded turn boundaries, item membership and parent-event coverage are complete; incomplete summaries retain canonical work duration without partial totals. [Sequences](flower-tool-sequences.md) independently fold settled work on each side.

## Reading and interface state
Running/preparing/retrying/finalizing/waiting turns stay expanded with an inaccessible reserved header slot; the toggle appears only when eligible. After a canonical outcome and end time, confirmed intermediate/typed process rows fold automatically, including the latest failed/cancelled/interrupted turn. Final and trailing partial output remain visible. Focus, selection, gestures, open details/thinking and reading away from the tail retain inspected work; observation cannot later undo that protection. Capture an unaffected visible anchor only when a real automatic collapse starts, and correct geometry through the existing scroll owner. Open/closed choices survive pagination, reconnects and regrouping. A newly classified row under inspection remains visible until the next explicit group toggle, without reopening other folded rows. Only an explicit disclosure or navigation action can open a closed group. Inspected bodies stay mounted and inert when folded, preserving nested choices and offsets. Main, embedded and child views share rendering with separate scroll owners.

## Layout and accessibility
The turn header precedes its first loaded response after the original request, independently of which rows may fold. Canonical intermediate membership spans all executions of the same turn; source-run supersession remains engine-owned. In-turn Goal facts retain their turn ownership across continuation. Unknown prose and final output remain visible. A partial window uses its first loaded response without fetching earlier history for presentation. Retained canonical prefixes keep confirmed intermediate membership across a new run; incoming window facts replace overlapping classifications, and final boundaries remain run-scoped. Prepending the actual beginning moves the header while retaining its turn choice and keyboard focus; the button reads turn disclosure state independently of its anchor row visibility.

The first loaded response reserves header geometry before eligibility; revealing the toggle never inserts space or narrows content. Automatic turn/sequence folding preserves the pre-fold scroll offset before paint, including temporary space from incoming prose while a sequence is still moving. The existing scroll owner retains only the trailing room required to prevent browser clamping, consumes it as new output grows, and releases it on explicit navigation. User scrolling updates the reading anchor even across empty reserved rows. Explicit manual open/close keeps the existing motion and reduced-motion preference; the disclosure owner retains the interaction choice. Canonical Path order, never timestamps, positions messages/receipts. Dialogue, final segments and secret-answer redaction remain intact.

# Boundaries

Disclosure is ephemeral UI state. Final content and dialogue stay mounted and ordered; summaries and network events cannot hide pending controls.

# Evidence

Browser regressions cover reserved running headers, frame-by-frame automatic fold offsets, repeated folds, subsequent growth, explicit navigation, short-history pagination, focus, selection and nested choices in main/child views. Continuation cases retain old-run prose and Goal; history prepends retain header focus and disclosure state. Existing isolated historical-copy qualification covers one opening read, no idle traversal, and complete statistics after explicit paging.

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Classifies interleaved answered inputs without changing ordinary turn disclosure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Verifies ordered checkpoints, stationary thinking-only completion, one-step automatic folding and preserved manual animation.
