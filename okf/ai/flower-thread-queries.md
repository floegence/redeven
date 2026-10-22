---
type: Integration Contract
title: Flower canonical thread queries
description: Find readable conversations and browse their canonical content through a minimal tool contract.
tags: [flower, floret, tools, authorization, queries]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower exposes two read-only tools for finding another readable conversation
and reading its content: `threads.query` and `threads.read`. The tool contract
is intentionally smaller than Floret's published general query API.
`threads.aggregate` is not registered or dispatched.

# Contract

## Find, browse, read

- `threads.query` defaults to `object: threads`, listing recently updated
  conversations first. Optional `title` is one literal, case-insensitive title
  fragment. Optional `thread_id` selects one exact conversation.
- To browse `messages` or `tool_calls`, provide one `thread_id`. Records are
  chronological; there are no model-controlled sort keys or detailed filters.
- `limit` defaults to 50, with a maximum of 200. Continue with `next_cursor` and
  unchanged input. Pass a record's `ref` to `threads.read` for complete content,
  following its cursor until no continuation remains.
- Nested `filter`, message-body matching, argument/result matching, keywords,
  phrases, time/role/tool/status predicates, grouping and aggregation are not
  accepted by the tool schema or handler. Unsupported inputs fail explicitly.
- Reasoning, secrets and private provider state remain excluded. Tool arguments
  and confirmed results are available only through authorized content reads.

## Authorization owner

Authenticated session authority supplies read permission, user, endpoint and
namespace identity. Redeven reconstructs the readable scope for every page and
read. Tool parameters and returned references never grant authority. Changed
scope invalidates frozen cursors; a new query starts under current permission.
The adapter uses published Floret public APIs and never reads Floret SQL or
reconstructs canonical records.

## Historical results and presentation

Saved query/read results remain previewable after restart and after their
original refs expire. The historical aggregate result renderer remains solely
for immutable already-saved tool exchanges; it cannot dispatch aggregation.
Private query contents are not added to Activity snapshots. The intent label
and explicitly opened, bounded result preview remain the presentation boundary.

## Storage and execution

The canonical owner stores source locators and metadata. Flower requires no
full-text index and schedules no startup or background indexing. Metadata-only
browsing requests one thread's ordered records; canonical full content is read
only as needed. Floret's retired optional indexing declarations are not a
product capability. The engine's published query API may retain compatibility
filters without exposing those filters to Flower's model tools.

# Evidence

- [Tool contract and adapter](../../internal/ai/thread_query_tools.go).
- [Browsing validation](../../internal/ai/thread_query_tools_test.go) and
  [scope/cursor tests](../../internal/ai/thread_reference_query_test.go).
- [Immutable saved-result previews](../../internal/ai/thread_tool_preview.go).
- [Released dependency pin](../../go.mod) and
  [dependency boundary gate](../../scripts/check_floret_dependency_boundary.sh).
