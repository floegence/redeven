---
id: K-TOOL-001
version: 1
title: knowledge.search is a read-only AI and chat surface over the embedded bundle
status: stable
owners:
  - ai
tags:
  - ai
  - knowledge
  - ui
source_card_id: K-TOOL-001
---

## Conclusion

Redeven exposes the embedded knowledge bundle through a read-only `knowledge.search` builtin tool, and Env App renders structured knowledge-search results inside Flower's compact activity timeline.

## Mechanism

Runtime knowledge code loads the embedded bundle once, scores cards in memory, builtin tool registration advertises `knowledge.search` as a non-mutating tool with a `knowledge` presentation spec, tool execution dispatches to `knowledge.Search` behind a read-permission gate, and `ActivityTimelineBlock` renders the compact research row with detail access for query, match, repo, and summary payloads.

## Boundaries

The tool returns scoped summaries rather than raw file-level evidence details and does not mutate the knowledge source or dist artifacts.

## Evidence

- redeven:internal/knowledge/search.go:38 - LoadEmbeddedBundle reads the embedded bundle lazily from embed FS.
- redeven:internal/knowledge/search.go:58 - Search ranks cards in memory and caps the result count.
- redeven:internal/ai/tools/registry.go:67 - Builtin presentation metadata classifies knowledge.search as research rendered by the knowledge activity renderer.
- redeven:internal/ai/builtin_tool_handlers.go:501 - Builtin tool registry declares knowledge.search as a non-mutating knowledge tool.
- redeven:internal/ai/run.go:3015 - Tool execution enforces read permission and dispatches to knowledge.Search.
- redeven:internal/ai/activity_timeline.go:438 - Activity projection summarizes knowledge.search as compact research activity.
- redeven:internal/envapp/ui_src/src/ui/chat/blocks/ActivityTimelineBlock.tsx:289 - Chat UI renders runtime-projected activity timelines instead of raw tool cards.

## Invalid Conditions

This card becomes invalid if knowledge queries stop reading the embedded bundle, expose raw file-level evidence by default, or bypass the read-permission gate.
