---
type: AI Tool Contract
title: Flower subagent runtime
tags: [ai, floret, subagents, permissions]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret v7 owns each SubAgent as a normal canonical child Thread. Redeven exposes product tools and Flower mappings over the typed `ThreadRuntime` without a second child identity, result store, recovery projection, or child lifecycle table. Parent-scoped summaries are bounded status only; the canonical child current view is the only complete handoff authority.

# Contract

The `subagents` tool supports spawn, send input, wait, list, status, inspect, close, and close all.

The model-facing result keeps child identity, task name, status, current turn, queue count, failure and interaction facts. Display timestamps, duplicated IDs and counts, and UI action flags remain outside that projection. Spawn and wait do not repeat task descriptions; list and explicit inspect retain them. A preview is omitted only when the same result carries the complete handoff.

Complete handoff bodies bypass generic output caps. Explicit event reads retain their full page contract. Bounded-wait and input-request metadata derive from the original execution result, never its compact model projection. Wait returns on child events and includes available complete reports; inspect explicitly reads reports. Tool descriptions state input and output semantics without prescribing a coordination workflow.

Parent reports, lifecycle events, bounded waiting, and the compact event panel are described in [Subagent parent events](subagent-parent-events.md).

## Child ownership and historical references
Forks copy conversation facts, never child ownership.

Missing targets are presented as missing rather than completed or timed out.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

# Evidence

- `redeven:internal/ai/subagents_model_payload.go` - Removes coordination display echoes without changing complete handoffs.

- `redeven:internal/ai/floret_tools.go` - Maps SubAgent calls and results into the typed operation Activity without losing action or target order.
