---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Redeven coordinates product thread snapshots with replayable Floret fork operations without compensation deletion or source drift.
tags: [ai, threads, persistence, floret]
timestamp: 2026-07-15T00:00:00Z
---

Flower thread fork is a cross-repository durable operation. Floret owns the engine thread journal, child thread plan, and turn/run identity mapping. Redeven owns the product thread, transcript anchors, structured user input, todos, memory, upload references, Flower metadata, and live thread-summary publication. Neither repository treats the other repository's target existence as proof that the whole product operation committed.

# Mechanism

Redeven threadstore schema v38 adds `ai_thread_fork_operations`. An operation has one required `ForkOperationID`, request fingerprint, source and destination thread identities, `pending | committed | failed` status, snapshot schema version, snapshot JSON, Floret result JSON, retry count, diagnostic code/message, broadcast acknowledgements, and timestamps.

`PrepareForkOperation` runs in one SQLite transaction. It validates that the operation request and destination are unused, reads the source product records, writes snapshot schema v1, and commits the operation as `pending`. The fixed snapshot contains the source thread, transcript messages, conversation turns, structured user inputs, todos, memory items, upload references, and Flower thread metadata. It intentionally excludes request-user-input secret answers, runs, run events, and every Floret-owned tool lifecycle or projection value. A later source-thread mutation cannot change what this operation will copy.

Redeven then calls the provider-free Floret maintenance host with the same operation ID, source thread, and planned destination. Floret owns its own fixed journal plan and returns the destination turn/run mappings. `CommitForkOperation` requires an exact mapping for every captured Redeven conversation turn, rejects missing, duplicate, or inconsistent identities, and uses the same mapping to rewrite destination turn, run, thread, trace, and assistant-message references. Floret may own additional journal turns that have no Redeven product anchor; those remain Floret-owned and do not create local rows. Redeven never allocates a local fallback turn or run identity. The transaction materializes the Redeven destination from the stored snapshot, stores the Floret result, clears the committed snapshot payload, and changes the operation to `committed`. Replaying an already committed operation returns the existing destination row; it does not copy again.

Startup and periodic maintenance scan pending operations in bounded batches. Replays call Floret with the original operation ID and destination, then retry the same Redeven snapshot commit. Explicit Floret operation conflicts, destination conflicts, missing completed targets, and Redeven destination conflicts become `failed`. Transport, storage, and other transient failures increment retry state while keeping the operation pending. There is no compensation call to delete a Floret destination, no regenerated destination identity, no reread of the current source state, and no branch that interprets an unmarked existing target as success.

After commit, Redeven serializes summary publication per service, reloads the current operation state, broadcasts each unacknowledged source or destination summary only after the summary can be built, and then records that side's publication acknowledgement. Maintenance republishes committed operations whose acknowledgements are incomplete; replaying a stale in-memory operation cannot republish a side whose durable acknowledgement is already present. Forked assistant and activity content remains owned by Floret and is read through public `ReadTurnProjection`; Redeven copies only product transcript rows and correlation anchors defined by snapshot schema v1.

# Invariants

- One operation ID identifies one exact request fingerprint and destination.
- Source snapshot capture happens before any Floret target is created.
- Product materialization never reads the live source thread.
- Every captured conversation turn uses the exact Floret destination turn/run mapping; unmapped or conflicting identities fail the operation.
- Secrets, runs, Floret tool lifecycle state, and Floret internal storage are not copied.
- A destination owned by another operation is a conflict, not a recovery hint.
- A pending operation remains replayable after process restart.
- Floret is consumed only through the published v0.9.0 public runtime API.

# References

[1] redeven:internal/ai/threadstore/schema.go:299 - Threadstore migration v38 creates durable fork operation storage.
[2] redeven:internal/ai/threadstore/fork_operation.go:176 - Fork preparation captures snapshot schema v1 transactionally.
[3] redeven:internal/ai/threadstore/fork_operation.go:254 - Fork commit materializes from the fixed snapshot and stores the Floret result.
[4] redeven:internal/ai/thread_fork_operation.go:20 - Redeven resumes one pending operation through Floret and local commit.
[5] redeven:internal/ai/thread_fork_operation.go:130 - Background maintenance replays pending operations in bounded batches.
[6] redeven:internal/ai/threads.go:577 - User-triggered fork prepares the durable operation before calling Floret.
[7] redeven:internal/ai/threadstore/fork_operation_test.go:13 - Reopen tests prove fixed snapshot and committed replay behavior.
[8] redeven:internal/ai/thread_fork_operation_test.go:14 - Process restart tests recover a Floret-completed pending operation.
