---
type: UI Contract
title: Flower terminal turn process disclosure
description: Collapse historical and successful work while protecting current abnormal work, explicit choices and active reading.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floret owns turn identity, outcome, final output and durations. Flower
uses validated detail only. Successful ordinary turns default to collapsed; the
latest failed, cancelled or interrupted turn stays expanded, while older
abnormal turns collapse after newer work starts. Dialogue, answered inputs and
final segments stay ordered and visible; unknown output is never hidden. Pending
interactions stay expanded, and reading protection preserves the reader's
position. If an answered input falls between process rows in a settled turn,
Flower shows a static overview and keeps the receipt as a visible checkpoint.
Settled tool sequences on either side default to independent collapsed groups;
active tools remain available. Ordinary turns keep whole-turn disclosure.

# Contract

## Canonical facts and eligibility
ThreadView and HistoryPage expose `turns`: exact TurnID and RunID, optional control kind, start and terminal time, outcome, elapsed/wait/work milliseconds, explicit ordered `intermediate_item_ids`, `final_item_ids` and `final_boundary_complete`. Summary updates cannot author them or trigger collapse.

The summary shows at most two nonzero time units, with subsecond copy; expansion reveals the original process without extra timing rows. A static overview for an interleaved answer also reports tool calls, failed calls, and answered input count; it never acts as a disclosure control.

## Reading and interface state
Running, preparing, retrying, finalizing and waiting turns remain expanded without a turn disclosure control. The latest ordinary turn retains process output, open thinking previews and details by default on failure, interruption or cancellation; users may then manually hide confirmed intermediate prose and explicitly typed process rows.

Main, embedded and child-detail timelines share the same renderer while using separate scroll controllers.

## Layout and accessibility
Messages and events share canonical Path ordering; timestamps never insert receipts.

Clarification receipts keep their existing secret-answer redaction.

# Boundaries

Disclosure is ephemeral UI state. Final content and dialogue stay mounted and ordered; summaries and network events cannot hide pending controls.

# Evidence

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Classifies interleaved answered inputs without changing ordinary turn disclosure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Verifies the checkpoint stays ordered between independently folded tool sequences.
