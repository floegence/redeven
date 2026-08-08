---
type: UI Contract
title: Flower live timeline
description: Canonical navigation and ownership boundary for Flower timeline presentation.
tags: [ai, flower, live, ui]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Flower is a reusable presentation surface over Floret-owned conversation and execution state. This overview is the canonical navigation point for timeline ordering, model/navigation behavior, terminal activity, approval/context state, and subagent detail. The focused concepts own their independent UI contracts so search and open operations can retrieve one behavior without loading the complete Flower implementation history.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [Flower timeline ordering](flower-timeline-ordering.md)
- [Flower model and navigation presentation](flower-model-navigation.md)
- [Flower terminal activity presentation](flower-terminal-activity.md)
- [Flower approval and context state](flower-approval-context.md)
- [Flower subagent detail presentation](flower-subagent-detail.md)

The focused timeline contract preserves Floret `ThroughOrdinal` and `ListThreadTurns` ordering, maps a valid non-renderable turn to `turn_projection_unavailable`, and records rejected public contracts as `floret.contract.rejected`; the detailed rules live in [Flower timeline ordering](flower-timeline-ordering.md).

# Boundaries

Flower must not reconstruct canonical execution, approval, context, read, or child state from transcript text, audit rows, previews, timestamps, or local heuristics. Full timeline replacement is reserved for explicit resynchronization, snapshot recovery, and terminal settlement finalization.

Realtime observation uses the Redeven Flower live hub and a single fetch-SSE connection per authorized surface. The hub performs canonical projection, privacy sanitization, deduplication, coalescing, and JSON encoding once, then fans out immutable batches to independent observer queues. Summary and selected-thread cursors carry explicit stream generations; a retention gap, generation reset, service restart, or slow-observer overflow emits one `resync_required` envelope and closes that observer. Flower keeps full detail for eight recent threads, retains all summary rows, and reboots an evicted selection from canonical bootstrap without clearing its separate composer or attachment state. Canonical batches exclude private read state; `viewer.read_state` is delivered only to connections for the same user. Hidden pages cancel their reader, and healthy heartbeats do not create application polling requests.

# Evidence

- `redeven:internal/ai/flower_live_projection.go:79` - Live bootstrap builds `timeline_messages` before returning the thread snapshot.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:128` - Flower recognizes `model_io.updated` as a model-status presentation boundary.
- `redeven:internal/envapp/ui_src/src/ui/chat/blocks/ShellBlock.tsx:377` - The terminal shell block builds process read, write, and terminate URLs from run and process ids.
- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:407` - `context.usage.updated` is applied as thread presentation state.
- `redeven:internal/ai/flower_live_stream.go:1` - The live hub shares immutable encoded batches, bounds retention and observer queues, and emits explicit resynchronization envelopes.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:3890` - Flower consumes one cancellable SSE stream and applies at most one render commit per animation frame.
- `redeven:internal/ai/subagents_floret.go:2096` - Redeven lists parent subagents through Floret host or maintenance host APIs.
