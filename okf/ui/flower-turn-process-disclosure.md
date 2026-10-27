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
Running/preparing/retrying/finalizing/waiting turns stay expanded without a toggle. After a canonical outcome and end time, confirmed intermediate/typed process rows fold automatically, including the latest failed/cancelled/interrupted turn. Final and trailing partial output remain visible. Focus, selection, gestures, open details/thinking and reading away from the tail retain inspected work; observation cannot later undo that protection. Capture an unaffected visible anchor only when a real automatic collapse starts, and correct geometry through the existing scroll owner. Open/closed choices survive pagination, reconnects and regrouping. A newly classified row under inspection remains visible until the next explicit group toggle, without reopening other folded rows. Only an explicit disclosure or navigation action can open a closed group. Inspected bodies stay mounted and inert when folded, preserving nested choices and offsets. Main, embedded and child views share rendering with separate scroll owners.

## Layout and accessibility
Automatic turn/sequence folding settles summary insertion and process removal in one layout update before paint. Explicit manual open/close keeps the existing motion and reduced-motion preference; the disclosure owner retains the interaction choice. Canonical Path order, never timestamps, positions messages/receipts. Dialogue, final segments and secret-answer redaction remain intact.

# Boundaries

Disclosure is ephemeral UI state. Final content and dialogue stay mounted and ordered; summaries and network events cannot hide pending controls.

# Evidence

The 2026-10-27 regressions cover manual interleaved folding with retained input checkpoints and nested choices, plus root/child wheel and keyboard paging from a bodyless collapsed window. Two isolated historical copies pass the product HTTP path: one opening read each, no idle history traversal, and complete statistics after explicit paging.

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Classifies interleaved answered inputs without changing ordinary turn disclosure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Verifies ordered checkpoints, stationary thinking-only completion, one-step automatic folding and preserved manual animation.
