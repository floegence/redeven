---
type: AI Persistence Contract
title: Flower thread deletion coordination
description: Durable delete intent removes the canonical Floret thread before host settings and resource ownership, then retries physical cleanup.
tags: [ai, threads, persistence, deletion, floret]
timestamp: 2026-07-22T00:00:00Z
---
# Summary

- Authority: Floret deletes the canonical Agent thread tree; Redeven deletes host settings, queue/routing/read state, upload ownership, audit-linked product rows, and physical upload files.
- Outcome: one stable delete operation records user intent and replays the same ordered steps after any crash.
- Invariants: resources remain owned while Floret deletion is unconfirmed, Redeven retires its current-process live presentation stream before invoking Floret deletion, and no compensation restores deleted canonical or product data.
- Failure boundary: transient external failures keep the operation pending; invalid durable snapshots become failed; missing Floret state is idempotent only for an already persisted operation.

# Contract

`PrepareThreadDeleteOperation` runs under the thread lifecycle gate. Before preparation, Redeven settles every queued command whose exact `TurnID` is already admitted in Floret; a read or settlement failure aborts without a delete intent. It then verifies that settings exist and no non-forced run, finalization, or idle compaction is active, captures the exact upload cleanup ids and read-state requirement, fingerprints the complete snapshot, and inserts one pending operation for the endpoint/thread identity. Run and compaction admission use the same gate and recheck writability before registration. Preparation does not delete settings, ownership, files, read state, or Floret data. Force deletion detaches or cancels active work only after this durable intent succeeds, so prepare failure has no runtime side effects. The operation id is stable and the retired-thread trigger prevents later reuse.

Delete snapshots accept only strict schema-v1 single-value JSON plus the stored full-payload fingerprint. Unknown fields, trailing values, unsupported schema, invalid cleanup ids, read-state mismatch, or fingerprint drift marks the operation failed before any Floret delete call. Replay never reconstructs a damaged snapshot from current product state.

Replay has one fixed order:

1. After validating the durable snapshot, retire the endpoint/thread key in Redeven's current-process Flower live presentation buffer. Retirement and live list/append use the same Service lock: retained events are removed, later append is discarded, and later list returns only an empty or resync response. This step is idempotent and is rebuilt when startup replays any partially completed pending delete.
2. Call Floret `ThreadDeleteHost.DeleteThread` for the canonical parent thread tree and durably confirm success. `ErrThreadNotFound` is success only while replaying this persisted delete intent.
3. In one Redeven transaction, mark the captured uploads for deletion, remove thread-scoped settings, queue, routing, transfer/handoff, permission audit ownership, and resource refs, and confirm product-data deletion.
4. Durably retire the Flower read-state identity and remove all current user-scoped read rows in one transaction, then confirm it. Future `EnsureFlower` and `AdvanceFlower` calls for that endpoint/thread are rejected, so concurrent or restarted surfaces cannot recreate read state after product cleanup.
5. Delete physical upload files, finalize upload rows, and confirm file cleanup.

The operation becomes committed only after every required confirmation is durable. A crash after any boundary repeats the same idempotent step. Floret failure leaves settings and resource ownership intact, so a canonical thread never points at a file that Redeven deleted early. File cleanup is last and retryable because physical deletion does not define Agent or host-data authority.

Startup scans every pending delete page before interrupted-turn targets are built. If a selected operation still has not deleted canonical/product state, startup fails closed instead of recovering a turn for a thread with durable delete intent. Operations that already removed product settings may continue retrying read-state or physical-file cleanup without becoming recovery targets.

The authenticated DELETE endpoint returns the durable operation result: committed is HTTP 200, retryable pending is HTTP 202 with the stable operation id, busy without force is HTTP 409, an unknown identity is HTTP 404, and a failed operation contract is HTTP 500.

# Boundaries

Delete never queries or edits Floret tables, never uses SubAgent close operations as a data-deletion substitute, never restores removed rows, never rebuilds a snapshot from current state, never treats absence as proof for an unrecorded step, and never uses a row-only read-state deletion that permits later reseeding.

The live retirement fence protects only Redeven's in-memory presentation buffer. It neither replaces nor proves canonical Floret deletion, stores no Floret thread state, and is never consulted as canonical thread authority. Its key includes both endpoint and thread identity. A list that detached its response before retirement may complete with that earlier snapshot; after retirement linearizes, no newly started list can expose retained payload and no append can recreate the stream. An append rejected by this fence is explicit to internal callers; a product action that requires a retained-event cursor returns a conflict instead of a successful zero cursor. The set is released with the Service, while startup replays pending durable deletes before runtime recovery is exposed.

# Evidence

- `redeven:internal/ai/threadstore/thread_delete_operation.go:57` - Preparation records intent without deleting settings or resources.
- `redeven:internal/ai/thread_delete_operation.go:66` - Replay deletes Floret first, then product state, read state, and files.
- `redeven:internal/ai/threadstore/thread_delete_operation.go:113` - Product deletion requires durable Floret confirmation.
- `redeven:internal/ai/thread_delete_operation_test.go:129` - Restart tests cover every durable step and Floret failure retention.
- `redeven:internal/ai/threadstore/thread_delete_operation_test.go:10` - Store tests cover intent, retirement, and confirmation order.
- `redeven:internal/ai/flower_live_projection.go:124` - Live list, append, and retirement share the Service lock and preserve endpoint-scoped presentation isolation.
- `redeven:internal/ai/flower_live_memory_test.go:72` - Focused tests cover endpoint isolation, retirement ordering, detached responses, late append rejection, and concurrent access.
