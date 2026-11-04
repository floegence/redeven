---
type: AI Tool Contract
title: Flower child runtime and parent event boundary
tags: [ai, floret, subagents, permissions]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Floret owns canonical child threads, reports and parent-scoped lifecycle events. Redeven projects bounded status and complete authorized handoffs without another store or scheduler. Child input and approvals remain blocked at their own boundary; labels and historical references never transfer ownership.

# Contract

## Child runtime
The `subagents` tool supports spawn, send input, wait, list, status, inspect, close, and close all.

The model-facing result keeps child identity, task name, status, current turn, queue count, failure and interaction facts. Display timestamps, duplicated IDs and counts, and UI action flags remain outside that projection. Spawn and wait do not repeat task descriptions; list and explicit inspect retain them. A preview is omitted only when the same result carries the complete handoff.

Complete handoff bodies bypass generic output caps. Explicit event reads retain their full page contract. Bounded-wait metadata derives from the original execution result, never its compact model projection. Wait returns on child events and includes available complete reports; inspect explicitly reads reports. Tool descriptions state input and output semantics without prescribing a coordination workflow.

Parent reports, lifecycle events, bounded waiting, and the compact event panel are described in [Subagent parent events](#parent-events).

Wait attention_required reports canonical child input/approval counts in each
item without creating a second parent confirmation. Child requests remain
blocked at their own authority boundary. The parent model can use completed
handoffs, perform independent work or explicitly ask for a dependency decision.
Unchanged attention is neither a timeout nor new progress. Parent UI activity
continues to derive solely from its canonical lifecycle; child badges retain the
real requests. Existing persisted parent requests remain operable after restart.

### Child ownership and historical references
Forks copy conversation facts, never child ownership.

Missing targets are presented as missing rather than completed or timed out.

## Parent events
Flower enables published Floret v7.49.0 parent events.

Floret atomically records references for completion, failure, cancellation, interruption, normalized execution timeout and input/approval attention alongside their canonical source.

The browser keeps only temporary reading/disclosure state.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

Events are observations and context inputs, not a second result store or a background scheduling mechanism. Task and execution authorization remain in the original `message`; see [Subagent runtime](#child-runtime).

# Evidence

- `redeven:internal/ai/subagents_model_payload.go` - Source.
- `redeven:internal/ai/floret_tools.go` - Source.

- `redeven:internal/ai/parent_events_test.go` - Tests.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
