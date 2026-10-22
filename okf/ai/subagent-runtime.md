---
type: AI Tool Contract
title: Flower subagent runtime
description: Canonical child threads, direct task instructions, scoped reads, and complete handoffs.
tags: [ai, floret, subagents, permissions]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret v7 owns each SubAgent as a normal canonical child Thread. Redeven exposes product tools and Flower mappings over the typed `ThreadRuntime` without a second child identity, result store, recovery projection, or child lifecycle table. Parent-scoped summaries are bounded status only; the canonical child current view is the only complete handoff authority.

# Contract

The `subagents` tool supports spawn, send input, wait, list, status, inspect, close, and close all.

Its allowlist contains thread identity, task name (140 code points), status, current turn, closed, queue count, update time, and optional failure code.

Parent reports, lifecycle events, bounded waiting, and the compact event panel are described in [Subagent parent events](subagent-parent-events.md).

## Child ownership and historical references
Forks copy conversation facts, never child ownership.

Missing targets are presented as missing rather than completed or timed out.

# Boundaries

Task labels and previews are presentation, not identity or results. Redeven must not query Floret storage, persist child lifecycle or handoff projections, infer membership from activity, or reintroduce publication, permission-snapshot, recovery, receipt, output-budget, or authority-barrier state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go` - Declares the strict subagent tool input.

- `redeven:internal/ai/subagents_floret.go` - Adapts subagent operations to typed Floret v7 child Thread methods.

- `redeven:internal/ai/floret_tools.go` - Maps SubAgent calls and results into the typed operation Activity without losing action or target order.
