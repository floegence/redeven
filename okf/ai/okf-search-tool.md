---
type: AI Tool Contract
title: OKF search tool
description: okf.search is a read-only AI and chat surface over the embedded OKF bundle.
tags: [ai, okf, ui]
timestamp: 2026-06-17T00:00:00Z
---

Redeven exposes the embedded OKF bundle through a read-only `okf.search` builtin tool, and Env App renders structured OKF search results inside Flower's compact activity timeline.

# Mechanism

Runtime OKF code loads the embedded bundle once, scores concepts in memory, builtin tool registration advertises `okf.search` as a non-mutating tool with structured presentation metadata, tool execution dispatches to `okf.Search` behind a read-permission gate, and `ActivityTimelineBlock` renders the compact research row with detail access for query and concept match payloads.

# Boundaries

The tool returns scoped concept summaries rather than raw file-level citation details and does not mutate OKF source or dist artifacts.

# Citations

[1] redeven:internal/okf/search.go:17 - LoadEmbeddedBundle reads the embedded bundle lazily once.
[2] redeven:internal/okf/search.go:38 - Search caps max results and filters optional tag constraints.
[3] redeven:internal/okf/search.go:100 - Concept scoring weights title, description, body, resource, type, and tags.
[4] redeven:internal/ai/tools/registry.go:67 - Builtin presentation metadata classifies `okf.search` as read-only structured research.
[5] redeven:internal/ai/builtin_tool_handlers.go:25 - Tool success summaries use the `okf.search` name directly.
[6] redeven:internal/ai/run.go:2949 - Tool execution dispatches the `okf.search` builtin to OKF search.
[7] redeven:internal/ai/run.go:2966 - Tool arguments are normalized into query, max result, and tag filters.
