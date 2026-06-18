---
type: AI Tool Contract
title: AI tool runtime
description: Redeven AI builtin tools are registered with permission semantics, presentation metadata, provenance, and runtime execution dispatch.
tags: [ai, tools, permissions, ui]
timestamp: 2026-06-18T00:00:00Z
---

Redeven's AI runtime treats tools as typed runtime capabilities. Builtins declare mutation and approval requirements, presentation metadata, grouping behavior, and renderer hints before execution dispatch reaches the runtime implementation.

# Mechanism

The builtin registry includes file, patch, terminal, web search, OKF search, todo, interaction, skill, and subagent tools. Mutating tools require approval by default; terminal commands are profiled per invocation; `okf.search` is read-only Redeven repository knowledge lookup; web search is read-only provider-backed public web discovery. Tool execution normalizes success summaries, errors, truncation, provenance, and builtin dispatch results so the chat activity timeline can render compact tool activity instead of raw low-level payloads.

`terminal.exec` is the local AI runtime shell. Its schema describes local execution, and successful terminal results include `execution_location=local_runtime` plus the resolved local working directory. Thread target context, Welcome environment context, or a target-shaped id does not change where this builtin runs.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge lookup is `okf.search` only. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Citations

[1] redeven:internal/ai/tools/registry.go:20 - Builtin tool definitions declare mutation, approval, and presentation specs.
[2] redeven:internal/ai/tools/registry.go:67 - `okf.search` is registered as a read-only structured tool activity.
[3] redeven:internal/ai/tools/registry.go:128 - Terminal command approval is decided from the invocation risk profile.
[4] redeven:internal/ai/builtin_tool_handlers.go:17 - Tool success summaries are normalized by builtin name or semantic activity category.
[5] redeven:internal/ai/builtin_tool_handlers.go:650 - `okf.search` is described as embedded Redeven repository knowledge, not internet search.
[6] redeven:internal/ai/run.go:2808 - Web search results receive source handling before final response synthesis.
[7] redeven:internal/ai/run.go:2997 - `okf.search` dispatches to the embedded OKF search implementation.
[8] redeven:internal/ai/prompt_builder.go:322 - Prompt construction routes information sources between workspace tools, OKF, and external web discovery.
[9] redeven:internal/ai/tools/registry.go:111 - Unknown tool names do not resolve to builtin definitions.
[10] redeven:internal/ai/target_tool_policy.go:48 - Target tool calls and results carry target id and execution location fields.
[11] redeven:internal/ai/run.go:3129 - Explicit target policy forwards eligible tools through the target executor.
[12] redeven:internal/ai/run.go:3466 - Local `terminal.exec` returns local runtime execution provenance.
[13] redeven:internal/ai/floret_tools.go:969 - Terminal activity chips render execution location and target id provenance.
