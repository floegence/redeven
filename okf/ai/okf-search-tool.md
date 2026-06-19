---
type: AI Tool Contract
title: OKF search tool
description: okf.search is a read-only Redeven repository knowledge lookup over the embedded OKF bundle.
tags: [ai, okf, ui]
timestamp: 2026-06-17T00:00:00Z
---

Redeven exposes the embedded OKF bundle through a read-only `okf.search` builtin tool, and Env App renders OKF activity as project knowledge lookup inside Flower's compact activity timeline.

# Mechanism

Runtime OKF code loads the embedded bundle once, scores concepts in memory, builtin tool registration advertises `okf.search` as a non-mutating tool with structured presentation metadata, tool execution dispatches to `okf.Search` behind a read-permission gate, and `ActivityTimelineBlock` renders compact knowledge-lookup activity with detail access for query and concept match payloads. OKF activity labels and operation values come from `ToolPresentationSpec`, so the Floret projection does not own a separate OKF display vocabulary.

# Boundaries

The tool returns scoped Redeven concept summaries rather than raw file-level citation details and does not mutate OKF source or dist artifacts. It does not access the internet and is not a substitute for web search, direct URL fetching, or external source validation. It must not be used for current news, recent public events, market or pricing facts, third-party documentation, or general web facts.

# Citations

[1] redeven:internal/okf/search.go:17 - LoadEmbeddedBundle reads the embedded bundle lazily once.
[2] redeven:internal/okf/search.go:37 - Search caps max results and filters optional tag constraints.
[3] redeven:internal/okf/search.go:123 - Concept scoring weights title, description, body, resource, type, and tags.
[4] redeven:internal/ai/tools/registry.go:157 - Builtin presentation metadata keeps `okf.search` read-only with structured rendering.
[5] redeven:internal/ai/builtin_tool_handlers.go:632 - Tool definition text limits `okf.search` to Redeven repository knowledge and excludes internet/current/general web facts.
[6] redeven:internal/ai/builtin_tool_handlers.go:33 - OKF success summaries use knowledge-lookup wording rather than the raw tool name.
[7] redeven:internal/ai/run.go:2997 - Tool execution dispatches the `okf.search` builtin to OKF search.
[8] redeven:internal/ai/run.go:3001 - Tool arguments are normalized into query, max result, and tag filters.
[9] redeven:internal/ai/floret_tools.go:716 - Floret result activity labels are derived from tool presentation label fields and fallbacks.
