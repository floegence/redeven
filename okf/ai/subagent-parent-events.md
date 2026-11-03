---
type: AI Runtime Contract
title: Flower subagent parent events
tags: [ai, floret, subagents, events]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Reports/lifecycle remain canonical Floret facts for the direct parent, without another handoff store or idle wakeup. Bounded wait/explicit reads expose them during continuation. Approvals/input stay child interactions; report_to_parent can communicate blockers without ending work.

# Contract

Flower enables published Floret v7.49.0 parent events.

Floret atomically records references for completion, failure, cancellation, interruption, normalized execution timeout and input/approval attention alongside their canonical source.

The browser keeps only temporary reading/disclosure state.

# Boundaries

Events are observations and context inputs, not a second result store or a background scheduling mechanism. Task and execution authorization remain in the original `message`; see [Subagent runtime](subagent-runtime.md).

# Evidence

- `redeven:internal/ai/parent_events_test.go` - Tests.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
