---
type: AI Tool Contract
title: Flower subagent runtime
description: Floret v4 child threads, strict tool input, parent membership, and canonical detail.
tags: [ai, floret, subagents, permissions]
timestamp: 2026-08-15T00:00:00Z
---
# Summary

Floret v4 owns each SubAgent as a normal canonical child Thread. Redeven exposes product tools and Flower mappings over the typed `ThreadRuntime` without a second child identity, publication operation, recovery projection, or child lifecycle table. Parent membership and canonical current views are the only lifecycle authority.

# Contract

The `subagents` tool supports spawn, send input, wait, list, inspect, close, and close all. Spawn requires `task_name`, `task_description`, `agent_type`, and `message`, with optional context mode. Title/objective aliases and inferred task names are rejected. Mission-only creates a child without inherited transcript; full-history uses the typed Floret fork path.

Redeven calls published Floret v4 typed Create/Fork, Send, View, List, and Delete operations. Floret allocates the canonical child `ThreadID`; that id is used in model results, Flower summaries, detail routes, interactions, and activity. There is no public or persisted `subagent_id`, publication receipt, provisional child identity, or recovery handle.

Spawn and child input use deterministic request keys scoped to the parent thread, parent turn, tool call, and canonical child where applicable. Repeating the same logical tool action therefore converges in the canonical journal without duplicate child input. Redeven may persist product settings for display and current policy, but those rows do not own membership, messages, queue, activity, or lifecycle.

Each child execution proves parent-child membership through the typed runtime and derives its current tool policy from Redeven settings. Child tools cannot address the root or a sibling, and the child surface excludes recursive subagent creation. Approval and Ask User interactions remain canonical child interactions; resolving them updates only that child current view.

Flower detail reads canonical child current state and typed activity through the parent-scoped product route. It does not parse metadata into messages, reconstruct activity from audits, or maintain a second child transcript. Parent cancellation may cancel active children, while thread deletion follows the canonical Floret tree deletion contract.

# Boundaries

Task labels are presentation, not identity. Redeven must not query Floret storage, persist child lifecycle projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, or authority-barrier state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go` - Declares the strict subagent tool input.
- `redeven:internal/ai/subagents_floret.go` - Adapts subagent operations to typed Floret v4 child Thread methods.
- `redeven:internal/ai/types.go` - Exposes canonical child `thread_id` in product views.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts` - Projects canonical child activity for Flower.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts` - Builds detail from the typed canonical child view.
