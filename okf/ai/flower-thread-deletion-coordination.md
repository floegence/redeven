---
type: AI Persistence Contract
title: Flower thread deletion coordination
description: Redeven persists one immutable delete operation and replays ordered cleanup across product files, Floret thread storage, and user read state without compensation restoration.
tags: [ai, threads, persistence, deletion, floret]
timestamp: 2026-07-15T00:00:00Z
---

Flower thread deletion crosses three ownership domains. Redeven owns product thread rows, transcript anchors, run and tool audit data, checkpoints, uploads, and user-scoped Flower read state. Floret owns the durable engine thread tree. A process can stop after any one of those stores changes, so deletion is represented as a durable operation rather than a sequence inferred from current absence or repaired by restoring old rows.

# Mechanism

Threadstore schema v39 adds `ai_thread_delete_operations`. The unique `(endpoint_id, thread_id)` pair maps to one stable operation id and a `pending | committed | failed` status. Snapshot schema v1 stores the exact checkpoint ids, upload cleanup ids, and whether Flower read-state cleanup is required. The operation also records product-data, file, Floret, and read-state confirmation times, retry count, stable error code, sanitized error message, and creation, update, and commit times. A database trigger and the create-thread path permanently reject reuse of an endpoint/thread identity that has any delete operation.

`PrepareThreadDeleteOperation` runs in one SQLite transaction. It returns an existing operation for an already prepared identity, otherwise requires the product thread to exist, captures the immutable cleanup snapshot, marks referenced upload candidates as deleting, removes every Redeven thread-scoped row and the thread row, inserts the pending operation, and records the product-data confirmation. No external file, Floret, or read-state mutation happens before that transaction commits.

Replay has one fixed order. Redeven removes checkpoint directories and upload artifacts named by the snapshot, then records the file confirmation. It opens one provider-free `ThreadMaintenanceHost` and calls `DeleteThread` for the Floret parent thread; `ErrThreadNotFound` is idempotent success only for this already-persisted operation, while every other error leaves the operation pending. Redeven next calls the injected `FlowerReadStateCleaner` for the endpoint/thread identity and records its confirmation. The operation becomes committed only when product data, files, Floret, and every required read-state step are durably confirmed. Invalid snapshot JSON or schema is a terminal contract failure and is marked failed before external cleanup runs.

Production opens the user read-state store before constructing the AI service and injects only the narrow cleaner contract. AI service startup synchronously replays pending deletes before scheduling title recovery or queued turns, and periodic maintenance continues bounded replay batches. A crash after product commit, file confirmation, Floret confirmation, or read-state deletion simply repeats the same idempotent operation. Redeven never restores deleted read-state or product rows, never regenerates a cleanup snapshot, never calls `CloseSubAgents` as a delete precondition, and never interprets missing data as proof that an unrecorded step succeeded.

The authenticated DELETE thread endpoint returns the operation result. `committed` is HTTP 200; a persisted operation that still needs retry is HTTP 202 with its stable operation id and `pending` status; a live busy thread without `force` is HTTP 409; an identity with neither a thread nor a historical operation is HTTP 404; and a failed operation contract is HTTP 500. Repeating DELETE after preparation returns the same operation identity instead of starting another deletion.

# Invariants

- Product deletion and operation creation commit atomically before external effects.
- The snapshot is immutable and every replay uses the same cleanup identities.
- File cleanup precedes Floret tree deletion, which precedes user read-state cleanup.
- Floret `ErrThreadNotFound` is idempotent success only inside an existing operation replay.
- Transient external failures remain pending; invalid durable snapshots become failed.
- Deleted thread identities cannot be reused.
- No compensation path restores old data or guesses an external step from absence.
- Redeven consumes only the published Floret `ThreadMaintenanceHost.DeleteThread` contract.

# References

[1] redeven:internal/ai/threadstore/schema.go:329 - Threadstore migration v39 creates the delete operation journal and retired-id trigger.
[2] redeven:internal/ai/threadstore/thread_delete_operation.go:58 - Preparation captures the snapshot and deletes product data in one transaction.
[3] redeven:internal/ai/thread_delete_operation.go:52 - Replay executes the fixed file, Floret, and read-state order.
[4] redeven:internal/ai/threads.go:952 - The product delete entrypoint enforces busy and force rules before preparing the operation.
[5] redeven:internal/ai/service.go:353 - Startup replays pending deletes before title and queued-turn recovery.
[6] redeven:internal/codeapp/codeapp.go:209 - Production opens read state before constructing the AI service and injecting the cleaner.
[7] redeven:internal/codeapp/appserver/server.go:4606 - AppServer maps delete operation outcomes to HTTP status.
[8] redeven:internal/ai/thread_delete_operation_test.go:129 - Restart tests cover every durable crash boundary.
[9] redeven:internal/ai/threadstore/thread_delete_operation_test.go:10 - Store tests cover snapshot capture, replay confirmations, and thread-id retirement.
