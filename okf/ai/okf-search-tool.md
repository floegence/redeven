---
type: AI Tool Contract
title: OKF tool suite
description: OKF tools expose read-only Redeven repository knowledge through index browsing, short search, and concept opening.
tags: [ai, okf, ui]
timestamp: 2026-06-17T00:00:00Z
---
# Summary

Redeven exposes the embedded OKF bundle through read-only `okf.index`, `okf.search`, and `okf.open` builtin tools, and the shared Flower surface renders OKF activity as project knowledge lookup rows with expandable detail.

OKF tools expose read-only Redeven repository knowledge through index browsing, short search, and concept opening.

# Contract

## Mechanism

Runtime OKF code loads the embedded bundle once, indexes root directory sections, scores structured summaries and sections in memory, and opens a concept summary or one selected section by id or path. The bundle builder parses internal Markdown links into deterministic `links` and `backlinks` and parses Evidence into structured references. Builtin tool registration advertises OKF tools as non-mutating local-read tools with structured presentation metadata, tool execution dispatches behind a read-permission gate, and Flower activity rows render compact knowledge-lookup details. OKF activity labels and operation values come from `ToolPresentationSpec`, so the Floret projection does not own a separate OKF display vocabulary.

## Tool workflow

`okf.index` browses `okf/index.md` as a structured directory and returns summaries plus section counts. `okf.search` returns a bounded short candidate list with query-aware snippets and the best matching section id/title; title and Summary matches outrank section body matches. Broad searches should start with the default small result count, and `has_more` means additional concepts exist rather than content truncation.

`okf.open` without `section` returns the concise Summary and section catalog. A second open with a section id returns only that section and applies the body window within the selected section. Evidence is omitted by default and is returned only through `section=evidence` or `include_evidence=true`. Models should follow `okf.index -> okf.search -> okf.open Summary -> okf.open section` and must not rely on snippets for detailed contracts.

# Boundaries

The tools return scoped Redeven repository knowledge and do not mutate OKF source or dist artifacts. They do not access the internet and are not a substitute for web search, direct URL fetching, or external source validation. They must not be used for current news, recent public events, market or pricing facts, third-party documentation, external facts, or general web facts. Source-level conclusions still require file or terminal verification after OKF navigation.

# Evidence

- `redeven:internal/okf/search.go:17` - LoadEmbeddedBundle reads the embedded bundle lazily once.
- `redeven:internal/ai/tools/registry.go:249` - Builtin presentation metadata keeps OKF tools read-only with structured rendering.
- `redeven:internal/ai/builtin_tool_handlers.go:662` - Tool definition text limits OKF tools to Redeven repository knowledge and excludes internet/current/general web facts.
- `redeven:internal/ai/run.go:3186` - Tool execution dispatches OKF builtins to index, search, and open runtime APIs.
- `redeven:internal/okf/parser.go:154` - The bundle builder parses internal Markdown links for OKF graph context.
- `redeven:internal/ai/floret_tools.go:716` - Floret result activity labels are derived from tool presentation label fields and fallbacks.
- `redeven:internal/okf/types.go:3` - Bundle concepts expose Summary, sections, and structured Evidence.
