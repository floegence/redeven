---
type: AI Tool Contract
title: AI tool runtime
description: Redeven AI builtin tools are registered with permission semantics, presentation metadata, and runtime execution dispatch.
tags: [ai, tools, permissions, ui]
timestamp: 2026-06-17T00:00:00Z
---

Redeven's AI runtime treats tools as typed runtime capabilities. Builtins declare mutation and approval requirements, presentation metadata, grouping behavior, and renderer hints before execution dispatch reaches the runtime implementation.

# Mechanism

The builtin registry includes file, patch, terminal, web search, OKF search, todo, interaction, skill, and subagent tools. Mutating tools require approval by default; terminal commands are profiled per invocation; `okf.search` is read-only Redeven repository knowledge lookup; web search is read-only provider-backed public web discovery. Tool execution normalizes success summaries, errors, truncation, and builtin dispatch results so the chat activity timeline can render compact tool activity instead of raw low-level payloads.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge lookup is `okf.search` only. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

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
