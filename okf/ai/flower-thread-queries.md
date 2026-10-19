---
type: Integration Contract
title: Flower canonical thread queries
description: Authorize canonical active-path search, counts and bounded content reads through released Floret tools.
tags: [flower, floret, tools, authorization, queries]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Floret v7.32.0 owns the canonical journal and its derived in-memory index.
Redeven exposes `threads.query`, `threads.read` and `threads.aggregate` as
read-only mappings to optional `runtime.ThreadQueryReader`. Every invocation
rebuilds the current readable scope before search, sorting, counting or reading.
References never grant access. Expired or invalidated cursors fail explicitly;
the model can narrow its query or start again.

# Contract

## Authorization owner

Authenticated session authority supplies read permission, user, endpoint and
namespace identity. Session metadata is immutable; current tool policy is
resolved by the existing Floret authorization boundary for every invocation.
Redeven queries only its own thread settings for the readable root and child
ThreadIDs in that endpoint and namespace. These fields plus user identity bind
the upstream scope; tool schemas cannot accept model-authored authority. Optional
ThreadID filters can narrow that scope. Every page and read repeats this check,
so namespace changes, deleted metadata and permission withdrawal cannot reuse a
previous broader scope. Redeven never reads Floret SQL, canonical records or
internal packages, and offers no arbitrary SQL tool.

## Query and content boundary

The upstream public `threadquery` types define objects, filters, sorting,
aggregation and pagination. Queries cover current active paths: conversation
metadata, canonically segmented user/assistant messages and exactly identified
local or persisted hosted tool calls. Reasoning, secrets, model-private state,
correction records, queued inputs and recovery records are excluded.

Fields combine with AND; enum choices combine with OR. Text supports literal
Unicode substrings, all/any keywords and contiguous phrases with optional exact
case. UTC time ranges include the start and exclude the end. Every sort has
stable identity ties. Aggregate shares Query filters for exact counts and UTC
calendar groups. Query defaults to 50 records and permits at most 200.

Tool schemas enumerate sort keys and describe their object-specific meaning.
`threads.query` accepts `created`, `updated`, `title`, `thread_id` for threads;
`time`, `order` for messages; and `time`, `completed`, `tool_name`, `elapsed`
for tool calls. Omitted or empty keys retain the released defaults (`created`,
`time`, `time`). Queries default to descending order, so new threads, messages
and tool calls appear first without additional arguments. An explicit
`descending: false` selects ascending order. Redeven sets the query direction
default before decoding input and preserves explicit values and unchanged
cursor continuation; it adds no fields, keys or sorting presets.
`threads.aggregate` keeps its separate `key` and `count` enum and ascending
default. Response field names such as `created_at` are not sort keys.

Floret remains the validation owner. Schema-invalid keys enter its bounded
correction path before tool dispatch and do not create visible failed Activity
rows. The host maps decode failures and published `ErrInvalidQuery` results to
`INVALID_ARGUMENTS`, retaining the original error identity. Unsupported sort
feedback names `sort.key`, the supplied value, the object, allowed values and
the default; invalid inputs are never silently corrected. Cursor, access,
storage and cancellation errors retain their own boundaries.

Query returns basic fields, hit summaries and exact opaque refs. Read returns
full visible content in UTF-8 chunks of at most 16 KiB and responses of at most
64 KiB, with explicit continuation instead of truncation. Confirmed tool inputs
and results stay behind authorized tool reads; query tool payloads are excluded
from ordinary Activity snapshots and list/timeline DTOs.

Query and read accept an optional `description` for a brief invocation intent
in the user's language. Flower prompts the model to supply it, preserves it
through completion and restart, and renders fixed `Thread Query:` / `Thread Read:`
prefixes. This display metadata is removed before typed canonical query decoding;
it never changes filters, sorting, pagination or authorization. Historical calls
without it retain neutral tool titles.

Activity expansion uses `POST /api/ai/threads/{threadID}/tool-preview` with exact
turn, run and tool-call identities. The service checks current read permission
and thread ownership before the published `runtime.ThreadToolResultReader`
lookup. It reads the saved confirmed invocation only, without redispatch, query
cursor reuse, canonical mutation or another result store. Missing, mismatched,
unauthorized or unsuccessful invocations return an unavailable preview.

The separate preview response includes readable filters, effective limit and
sort direction, total matches, record titles and excerpts. Read previews join
contiguous UTF-8 body chunks and reuse tool presentation allowlists for confirmed
arguments/results. Opaque refs, cursors, context and raw envelopes are omitted.
The server returns at most ten result rows, 160 title characters and 1,200 content
characters per row, with explicit truncation/continuation notices. The UI starts
with three results and two-line excerpts, supports local expansion, and exposes
loading and retry states. Historical results remain readable after restart even
when original query refs have expired.

## Index and snapshots

The canonical log owner rebuilds its derived index after startup verification
and updates it only after successful canonical commits. Rollback never publishes
index changes. Identity, fields, time and Unicode position/n-gram indexes select
candidates before exact verification; canonical records remain the only body
source. Redeven does not maintain an index or a second query corpus.

The first query freezes canonical record references and stable sort keys in the
upstream memory budget (five minutes, 64 MiB total). Append, rename and tool
completion do not alter a snapshot. Delete, authorization-scope changes,
restart, expiry or eviction invalidate continuation explicitly. A new query
uses current authority and never silently expands the old scope.

# Boundaries

Only published Floret contracts can supply canonical content. Product metadata
defines authorization scope; references, tool arguments and opaque refs cannot
expand it. This capability adds no product persistence or runtime lifecycle.

# Evidence

- [Released dependency pin](../../go.mod) and [dependency gate](../../scripts/check_floret_dependency_boundary.sh).
- [Typed query tools](../../internal/ai/thread_query_tools.go), [exact run capabilities](../../internal/ai/run_host_capabilities.go) and [product metadata scope](../../internal/ai/threadstore/store.go).
- [Authorization and frozen replay tests](../../internal/ai/thread_reference_query_test.go).
- [Sort schema and error mapping tests](../../internal/ai/thread_query_tools_test.go) and [published-runtime correction coverage](../../internal/ai/thread_query_correction_test.go).
- [Authorized saved preview](../../internal/ai/thread_tool_preview.go) and [canonical restart/bounds coverage](../../internal/ai/thread_tool_preview_test.go).
- [Private Activity boundary](../../internal/ai/tool_activity_details.go) and [tool presentation registry](../../internal/ai/tools/registry.go).
- [Composer references](../ui/flower-composer-references.md) owns the user-facing snapshot workflow.
