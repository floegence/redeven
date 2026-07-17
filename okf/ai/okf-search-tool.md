---
type: AI Tool Contract
title: OKF tool suite
description: OKF tools expose read-only Redeven repository knowledge through index browsing, short search, and concept opening.
tags: [ai, okf, ui]
timestamp: 2026-06-17T00:00:00Z
---

Redeven exposes the embedded OKF bundle through read-only `okf.index`, `okf.search`, and `okf.open` builtin tools, and the shared Flower surface renders OKF activity as project knowledge lookup rows with expandable detail.

# Mechanism

Runtime OKF code loads the embedded bundle once, indexes root directory sections, scores concepts in memory, and opens concept bodies by id or path. The bundle builder parses internal Markdown links into deterministic `links` and `backlinks` so concept detail can expose graph context without scanning source Markdown at runtime. Builtin tool registration advertises OKF tools as non-mutating local-read tools with structured presentation metadata, tool execution dispatches behind a read-permission gate, and Flower activity rows render compact knowledge-lookup details for directory sections, concept matches, opened concept metadata, and link graph payloads. OKF activity labels and operation values come from `ToolPresentationSpec`, so the Floret projection does not own a separate OKF display vocabulary.

# Tool workflow

`okf.index` browses `okf/index.md` as a structured directory and should be used first for broad Redeven-internal questions when the relevant concept area is unclear. `okf.search` returns a bounded short candidate list with `concept_id`, `path`, title, description, resource, tags, snippet, score, returned count, total match count, and explicit `has_more` metadata; broad searches should start with the default small result count. Limiting search to a short candidate list is progressive disclosure, not content truncation. `okf.open` opens one concept by `concept_id` or path and returns metadata, a body window, and links/backlinks. Models should open the relevant concept before relying on OKF for detailed facts, boundaries, contracts, or workflows.

# Boundaries

The tools return scoped Redeven repository knowledge and do not mutate OKF source or dist artifacts. They do not access the internet and are not a substitute for web search, direct URL fetching, or external source validation. They must not be used for current news, recent public events, market or pricing facts, third-party documentation, external facts, or general web facts. Source-level conclusions still require file or terminal verification after OKF navigation.

# Citations

[1] redeven:internal/okf/search.go:17 - LoadEmbeddedBundle reads the embedded bundle lazily once.
[2] redeven:internal/okf/search.go:37 - `Index`, `Search`, and `Open` load the embedded bundle and return structured OKF payloads.
[3] redeven:internal/okf/search.go:78 - Search caps max results and filters optional type and tag constraints.
[4] redeven:internal/ai/tools/registry.go:249 - Builtin presentation metadata keeps OKF tools read-only with structured rendering.
[5] redeven:internal/ai/builtin_tool_handlers.go:662 - Tool definition text limits OKF tools to Redeven repository knowledge and excludes internet/current/general web facts.
[6] redeven:internal/ai/builtin_tool_handlers.go:33 - OKF success summaries use knowledge-lookup wording rather than the raw tool name.
[7] redeven:internal/ai/run.go:3186 - Tool execution dispatches OKF builtins to index, search, and open runtime APIs.
[8] redeven:internal/okf/parser.go:154 - The bundle builder parses internal Markdown links for OKF graph context.
[9] redeven:internal/ai/floret_tools.go:716 - Floret result activity labels are derived from tool presentation label fields and fallbacks.
