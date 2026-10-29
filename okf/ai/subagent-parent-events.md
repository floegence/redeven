---
type: AI Runtime Contract
title: Flower subagent parent events
tags: [ai, floret, subagents, events]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

SubAgent reports and lifecycle events remain canonical Floret facts, visible to the direct parent without creating another handoff store. They do not wake idle parents; bounded waiting and explicit reads expose reports when the parent continues. Tool approval and user input remain ordinary child interactions, while questions and blockers can be reported through `report_to_parent` without ending the delegated task.

# Contract

Flower enables published Floret v7.49.0 parent events.

Floret atomically records references for completion, failure, cancellation, interruption, normalized execution timeout and input/approval attention alongside their canonical source.

The browser keeps only temporary reading/disclosure state.

# Boundaries

Events are observations and context inputs, not a second result store or a background scheduling mechanism. Task and execution authorization remain in the original `message`; see [Subagent runtime](subagent-runtime.md).

# Evidence

- `redeven:internal/ai/parent_events_test.go` - Covers scoped reports, lifecycle references, bounded reads, waits and input attention.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Presents parent events and canonical child current views.
