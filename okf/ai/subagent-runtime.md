---
type: AI Tool Contract
title: Flower subagent runtime
description: Floret v7 child threads, parent membership, bounded status, and complete handoffs.
tags: [ai, floret, subagents, permissions]
timestamp: 2026-09-02T00:00:00Z
---
# Summary

Floret v7 owns each SubAgent as a normal canonical child Thread. Redeven exposes product tools and Flower mappings over the typed `ThreadRuntime` without a second child identity, result store, recovery projection, or child lifecycle table. Parent-scoped summaries are bounded status only; the canonical child current view is the only complete handoff authority.

# Contract

The `subagents` tool supports spawn, send input, wait, list, inspect, close, and close all. Spawn requires `task_name`, `task_description`, `agent_type`, and `message`, with optional context mode. Title/objective aliases and inferred task names are rejected. Mission-only creates a child without inherited transcript; full-history uses the typed Floret fork path.

Every tool call and result uses Floret's typed `subagent_operation` Activity renderer. Its payload keeps the exact action, requested target order, task display fields, target status, requested/completed/missing counts, timeout state, and public error. Redeven never truncates a multi-target operation to its first child. Wait targets join current summaries only by canonical `ThreadID`; labels and unrelated child lists are not fallback identity. The older `subagent` renderer remains limited to one durable child-thread fact and is not an operation fallback.

List and each result `items` entry expose `last_message_preview` only for bounded status context. Wait and inspect prove membership through the parent-scoped list, then read every selected completed child through typed `View`. They return one ordered `handoffs` array containing the exact final non-live Assistant text from the current Turn together with its `ThreadID`, `TurnID`, and `RunID`. A timed-out wait still returns handoffs for completed children and status only for active children. A failed View read, identity mismatch, changed completion state, or completed Turn without a final Assistant item fails explicitly; preview text never substitutes for a handoff.

Model-visible handoff content bypasses Redeven's Activity-size sanitizer and remains subject only to Floret's standard tool-output projection. The Activity projection reads its own bounded status allowlist and never copies or scans handoff content, so a long report cannot create a false Activity truncation state.

Redeven calls published Floret v7 typed Create/Fork, Send, View, List, and Delete operations. Floret allocates the canonical child `ThreadID`; that id is used in model results, Flower summaries, detail routes, interactions, and activity. There is no public or persisted `subagent_id`, publication receipt, provisional child identity, or recovery handle.

Spawn and child input use deterministic request keys scoped to the parent thread, parent turn, tool call, and canonical child where applicable. Repeating the same logical tool action therefore converges in the canonical journal without duplicate child input. Redeven may persist product settings for display and current policy, but those rows do not own membership, messages, queue, activity, or lifecycle.

Each child execution proves parent-child membership through the typed runtime and derives its current tool policy from Redeven settings. Child tools cannot address the root or a sibling, and the child surface excludes recursive subagent creation. Approval and Ask User interactions remain canonical child interactions; resolving them updates only that child current view.

Flower detail reads canonical child current state and typed activity through the parent-scoped product route. It does not parse metadata into messages, reconstruct activity from audits, or maintain a second child transcript. Parent cancellation may cancel active children, while thread deletion follows the canonical Floret tree deletion contract.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go` - Declares the strict subagent tool input.
- `redeven:internal/ai/subagents_floret.go` - Adapts subagent operations to typed Floret v7 child Thread methods.
- `redeven:internal/ai/floret_tools.go` - Maps SubAgent calls and results into the typed operation Activity without losing action or target order.
- `redeven:internal/ai/subagents_handoff_test.go` - Proves complete handoffs, timeout behavior, identity failures, and Activity separation.
- `redeven:internal/ai/types.go` - Exposes canonical child `thread_id` in product views.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts` - Projects canonical child activity for Flower.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts` - Builds detail from the typed canonical child view.
