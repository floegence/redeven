---
type: UI Contract
title: Flower terminal turn process disclosure
description: Collapse historical and successful work while protecting current abnormal work, explicit choices and active reading.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floret owns turn identity, outcome, timing and explicit final boundaries. Flower collapses successful ordinary turns and older abnormal work while protecting the latest abnormal turn, pending controls and active reading. Dialogue/finals stay visible. Interleaved answered inputs retain visible checkpoints between independently folded sequences.

# Contract

## Canonical facts and eligibility
Validated ThreadView/HistoryPage turn facts include exact TurnID/RunID, optional control kind, start/end, outcome, elapsed/wait/work durations, ordered intermediate/final item IDs and complete-final boundary. Summaries cannot author them or trigger collapse; unknown output remains visible.

Summaries show at most two nonzero time units with subsecond copy. Interleaved answers use a static overview counting calls, failures and answered inputs, never a whole-turn toggle. [Sequences](flower-tool-sequences.md) independently fold settled work on each side.

## Reading and interface state
Running/preparing/retrying/finalizing/waiting turns stay expanded without a toggle. Latest failed/cancelled/interrupted ordinary work retains process, thinking and details; users may hide only confirmed intermediate/typed process rows. Newer work permits older abnormal collapse; explicit choices/reading protection survive updates. Main, embedded and child views share rendering with separate scroll owners.

## Layout and accessibility
Canonical Path order, never timestamps, positions messages/receipts. Dialogue, final segments and secret-answer redaction remain intact.

# Boundaries

Disclosure is ephemeral UI state. Final content and dialogue stay mounted and ordered; summaries and network events cannot hide pending controls.

# Evidence

- `redeven:go.mod` - Published Floret dependency.

- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Classifies interleaved answered inputs without changing ordinary turn disclosure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Verifies the checkpoint stays ordered between independently folded tool sequences.
