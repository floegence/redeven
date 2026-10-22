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

Published Floret owns each turn's identity, outcome, final output boundary and durations. Flower consumes only validated detail accepted by ThreadCache. Successful ordinary turns default to collapsed, including legacy history whose explicitly typed process can be separated safely from assistant output. Failure, cancellation and interruption default to expanded only for the latest ordinary turn; older abnormal work defaults to collapsed once a newer ordinary turn starts. Users, resolved clarification answers and every final segment remain visible in their original order; unknown assistant output is never hidden. Pending interactions remain expanded without a turn disclosure control. Reading protection overrides automatic collapse once, without a later timer.

# Contract

## Canonical facts and eligibility
ThreadView and HistoryPage expose `turns`: exact TurnID and RunID, optional control kind, start and terminal time, outcome, elapsed/wait/work milliseconds, explicit ordered `intermediate_item_ids`, `final_item_ids` and `final_boundary_complete`. Summary updates cannot author them or trigger collapse.

The summary shows at most two nonzero time units, with subsecond copy; expansion reveals the original process without extra timing rows.

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
