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

A provider continuation failure after settled tool activity has one compact
error surface. Settled declined tools remain quiet canonical activity, and the
only action is `Retry reply`. The action invokes the thread retry adapter and
applies the returned canonical bootstrap; it never launches a new user turn or
submits an approval. While the request is active, duplicate clicks are ignored.
A transport failure keeps the same single error surface retryable, while a
successful retry replaces it through normal canonical live/bootstrap
reconciliation. Provider configuration failures that are not continuation
failures retain their settings action.

An empty failed retry projection remains observable only while it is the latest
unrecovered continuation. Once a later canonical retry references that turn,
Flower omits the superseded projection-unavailable decoration and renders the
later retry outcome. Canonical retry turns remain intact in Floret; this rule
only prevents a recovered failure from leaving a second persistent error face.

# Evidence

- `redeven:internal/ai/flower_live_projection.go:79` - Live bootstrap builds `timeline_messages` before returning the thread snapshot.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:128` - Flower recognizes `model_io.updated` as a model-status presentation boundary.
- `redeven:internal/envapp/ui_src/src/ui/chat/blocks/ShellBlock.tsx:377` - The terminal shell block builds process read, write, and terminate URLs from run and process ids.
- `redeven:internal/flower_ui/src/flowerLiveReducer.ts:407` - `context.usage.updated` is applied as thread presentation state.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - Verifies the single retry action, retry request failure, and preservation of declined activity without launching a user turn or approval.
- `redeven:internal/ai/flower_live_stream.go:1` - The live hub shares immutable encoded batches, bounds retention and observer queues, and emits explicit resynchronization envelopes.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:3890` - Flower consumes one cancellable SSE stream and applies at most one render commit per animation frame.
- `redeven:internal/ai/subagents_floret.go:2096` - Redeven lists parent subagents through Floret host or maintenance host APIs.
