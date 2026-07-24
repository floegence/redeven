---
type: AI Persistence Contract
title: Flower thread deletion coordination
description: Durable delete intent retires product access, removes the canonical Floret thread before host resources, and replays one serialized cleanup path.
tags: [ai, threads, persistence, deletion, floret]
timestamp: 2026-07-22T00:00:00Z
---
# Summary

- Authority: Floret deletes the canonical Agent thread tree; Redeven deletes host settings, queue/routing/read state, upload ownership, audit-linked product rows, and physical upload files.
- Outcome: one stable delete operation records user intent, immediately retires product visibility, and replays the same ordered steps after any crash.
- Invariants: resources remain owned while Floret deletion is unconfirmed, every replay uses one per-thread executor, and no compensation restores deleted canonical or product data.
- Failure boundary: transient external failures keep the operation pending; invalid durable snapshots or canonical identity failures become terminally failed and block every startup until repaired.

# Contract

`PrepareThreadDeleteOperation` runs under the thread lifecycle gate. It first settles queued commands already admitted in Floret, verifies settings and non-forced activity, then persists one fingerprinted snapshot of product cleanup ids and read-state requirements. Preparation deletes nothing. Force deletion stops active work only after intent is durable, so prepare failure has no runtime side effects. Run and compaction admission use the same gate and recheck writability.

Delete snapshots accept only strict schema-v1 single-value JSON plus the stored full-payload fingerprint. Unknown fields, trailing values, unsupported schema, invalid cleanup ids, read-state mismatch, or fingerprint drift marks the operation failed before any Floret delete call. Replay never reconstructs a damaged snapshot from current product state.

Replay has one fixed order:

1. Retire the endpoint/thread key in the current-process Flower live buffer. The shared Service lock removes retained events and rejects later append/list exposure; startup replay rebuilds this idempotent fence.
2. Call Floret `ThreadDeleteHost.DeleteThread` for the canonical parent thread tree and durably confirm only a `nil` result. Floret's exact tombstone replay returns `nil`; `ErrThreadNotFound` means no live root and no tombstone, so Redeven marks the operation terminally failed and preserves all product data.
3. In one Redeven transaction, mark the captured uploads for deletion, remove thread-scoped settings, queue, routing, transfer/handoff, permission audit ownership, and resource refs, and confirm product-data deletion.
4. Retire the Flower read-state identity and its user rows transactionally, preventing later reseeding, then confirm it.
5. Delete physical upload files, finalize upload rows, and confirm file cleanup.

The operation commits only after every confirmation is durable. Explicit DELETE, startup recovery, and periodic maintenance all enter the per-thread lifecycle gate, reread and validate the exact operation identity, and advance only pending work. Committed and failed operations repeat no side effects. No SQLite transaction spans a Floret, read-state, or filesystem call.

Floret failure leaves settings and resource ownership intact. Typed canonical identity or invariant errors are terminal; busy, closing, stale authority, cancellation, store closure, committed cleanup, and unclassified transient errors remain pending. Redeven never classifies a Floret error by message text.

Startup rejects any failed delete, then scans all pending pages before building interrupted-turn targets. Replay failure or unremoved canonical/product state fails closed; every restart checks terminal failures again. Operations past product deletion may retry read-state or file cleanup without becoming recovery targets.

Once intent is durable, Redeven excludes the endpoint/thread from SQL list pagination and rejects detail access before opening a Floret reader. This product projection is not a canonical deletion conclusion. The Flower surface adds the id to a non-persistent retirement set before clearing presentation state, so stale list, detail, live, or mutation responses cannot reinsert it.

The authenticated DELETE endpoint accepts only an absent query or one exact `force=true|false` pair. Its durable receipt always includes the stable operation id, status, and `intent_persisted=true`: committed is HTTP 200, retryable pending is HTTP 202 with audit outcome `accepted`, busy without force is HTTP 409, an unknown identity before intent is HTTP 404, and a terminal operation is HTTP 500 with `AI_THREAD_DELETE_OPERATION_FAILED`. Flower always sends `force=true` after one destructive confirmation. A 200 result reports completion; 202 retires the conversation while explaining that cleanup continues in the background; a structured terminal receipt also retires it but reports that local data needs repair and restart. Failures without a durable receipt preserve the dialog, selection, and draft.

# Boundaries

Delete never queries or edits Floret tables, never stores a canonical Agent projection, never enumerates children in Redeven, never uses SubAgent close operations as a data-deletion substitute, never restores removed rows, never rebuilds a snapshot from current state, never treats absence as proof for an unrecorded step, and never uses a row-only read-state deletion that permits later reseeding.

The Service live fence is endpoint/thread scoped and protects only in-memory presentation; it stores no Floret state and proves no canonical result. Calls that start after retirement cannot expose or append retained payload. The set ends with the Service, while startup reconstructs it from pending durable intent before recovery is exposed.

# Evidence

- `redeven:internal/ai/threadstore/thread_delete_operation.go:117` - Preparation records intent without deleting settings or resources.
- `redeven:internal/ai/thread_delete_operation.go:135` - The serialized replay executor rereads the operation and advances its fixed cleanup order.
- `redeven:internal/ai/threads.go:985` - The authenticated service operation prepares intent before entering the serialized replay executor.
- `redeven:internal/ai/threadstore/store.go:255` - Product list pagination excludes durable delete intent in SQL.
- `redeven:internal/ai/threadstore/thread_delete_operation.go:201` - Product deletion requires durable Floret confirmation.
- `redeven:internal/ai/thread_delete_operation_test.go:446` - Restart tests cover every durable step and Floret failure retention.
- `redeven:internal/ai/threadstore/thread_delete_operation_test.go:302` - Store tests cover intent and confirmation order through final commit.
- `redeven:internal/codeapp/appserver/server_test.go:3316` - API tests cover strict force parsing, durable pending receipts, and accepted audit outcomes.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:4300` - The surface retirement fence clears product presentation and rejects stale responses.
- `redeven:internal/ai/flower_live_projection.go:1115` - Live retirement shares the Service lock with list and append access.
- `redeven:internal/ai/flower_live_memory_test.go:72` - Focused tests cover endpoint isolation, retirement ordering, detached responses, late append rejection, and concurrent access.
