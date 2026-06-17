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

[1] redeven:internal/okf/search.go:38 - LoadEmbeddedBundle reads the embedded bundle lazily from embed FS.
[2] redeven:internal/okf/search.go:58 - Search ranks concepts in memory and caps the result count.
[3] redeven:internal/ai/tools/registry.go:67 - Builtin presentation metadata classifies okf.search as research rendered by the structured renderer.
[4] redeven:internal/ai/builtin_tool_handlers.go:501 - Builtin tool registry declares okf.search as a non-mutating OKF tool.
[5] redeven:internal/ai/run.go:3015 - Tool execution enforces read permission and dispatches to okf.Search.
[6] redeven:internal/ai/activity_timeline.go:438 - Activity projection summarizes okf.search as compact research activity.
[7] redeven:internal/envapp/ui_src/src/ui/chat/blocks/ActivityTimelineBlock.tsx:289 - Chat UI renders runtime-projected activity timelines instead of raw tool cards.
