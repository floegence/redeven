---
type: AI Tool Contract
title: OKF tool suite
tags: [ai, okf, ui]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Redeven exposes the embedded OKF bundle through read-only `okf_get_index`, `okf_search`, and `okf_open` builtin tools. Redeven projects bounded safe results into Floret v7.26.0 structured Activity rows, and the shared Flower surface expands those rows without reading raw OKF result JSON.

# Contract

## Mechanism
Runtime OKF code loads the embedded bundle once, indexes root directory sections, scores structured summaries and sections in memory, and opens a concept summary or one selected section by id or path. Internal ids, paths, and unfiltered result objects never enter that display contract. OKF activity labels and operation values come from `ToolPresentationSpec`, so the Floret projection does not own a separate OKF display vocabulary.

## Tool workflow
`okf_get_index` browses `okf/index.md` as a structured directory and returns summaries plus section counts. `okf_search` returns a bounded short candidate list with query-aware snippets and the best matching section id/title; title and Summary matches outrank section body matches.

Evidence narrative participates in search and the section catalog. Explicit `section: "evidence"` reads its bounded body and references; `include_evidence` on another section adds only structured references. Default opening omits evidence content.

Models should follow `okf_get_index -> okf_search -> okf_open Summary -> okf_open section` and must not rely on snippets for detailed contracts.

# Boundaries

The tools return scoped Redeven repository knowledge and do not mutate OKF source or dist artifacts. They must not be used for current news, recent public events, market or pricing facts, third-party documentation, external facts, or general web facts. Source-level conclusions still require file or terminal verification after OKF navigation.

# Evidence

- `redeven:internal/okf/search.go:17` - Source.
