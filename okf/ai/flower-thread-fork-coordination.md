---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Redeven coordinates product thread snapshots with replayable Floret fork operations without compensation deletion or source drift.
tags: [ai, threads, persistence, floret]
timestamp: 2026-07-15T00:00:00Z
---

Flower thread fork is a cross-repository durable operation. Floret owns the engine journal, conversation, turn/run identity mapping, projections, control signals, approvals, and Agent todo state. Redeven owns only the product thread configuration, upload and attachment references, Flower UI metadata, and summary publication. Neither repository treats the other repository's target existence as proof that the whole product operation committed.

# Mechanism

Redeven canonical threadstore schema v2 contains `ai_thread_fork_operations`. An operation has one required `ForkOperationID`, request fingerprint, source and destination thread identities, `pending | committed | failed` status, snapshot schema version, snapshot JSON, retry count, diagnostic code/message, broadcast acknowledgements, and timestamps. It stores no Floret result, turn map, conversation, or Agent lifecycle payload. Known pre-release threadstores are upgraded transactionally by retaining product tables and deleting Agent shadow tables; failed upgrades roll back, while unknown kinds and future versions remain rejected.

`PrepareForkOperation` runs in one SQLite transaction. It validates that the operation request and destination are unused, writes snapshot schema v2, and commits the operation as `pending`. The fixed snapshot contains the source product thread configuration, upload references, and Flower metadata only. It contains no user or assistant content, turn/run state, projection, control signal, approval, todo, memory, context, or provider state. A later source-thread mutation cannot change what this operation will copy.

Redeven then calls the provider-free Floret maintenance host with the same operation ID, source thread, and planned destination. Floret forks the complete canonical thread, including Agent todo state, and returns destination turn/run mappings. Redeven uses those mappings only during the current materialization call to rewrite opaque turn/run foreign keys on copied product resource references, such as upload bindings. Missing mappings cause the affected optional reference to remain uncopied; duplicate or malformed source/destination identities are contract errors. Redeven never creates a conversation row, allocates another turn/run identity, or persists the returned map. The transaction materializes the destination product configuration from the fixed snapshot, clears the committed snapshot payload, and changes the operation to `committed`.

Startup and periodic maintenance scan pending operations in bounded batches. Replays call Floret with the original operation ID and destination; Floret idempotently returns the canonical rewrite map again, and Redeven retries the same product snapshot commit without having cached that result. Explicit Floret operation conflicts, destination conflicts, missing completed targets, and Redeven destination conflicts become `failed`. Transport, storage, and other transient failures increment retry state while keeping the operation pending. There is no compensation call to delete a Floret destination, no regenerated destination identity, no reread of the current source state, and no branch that interprets an unmarked existing target as success.

After commit, Redeven serializes summary publication per service, reloads the current operation state, broadcasts each unacknowledged source or destination summary only after the summary can be built from product metadata plus public Floret state, and then records that side's publication acknowledgement. Maintenance republishes committed operations whose acknowledgements are incomplete. Forked conversation and Agent state remain owned by Floret and are read through `ReadThread`, `ListThreadTurns`, and the typed todo API.

# Invariants

- One operation ID identifies one exact request fingerprint and destination.
- Source snapshot capture happens before any Floret target is created.
- Product materialization never reads the live source thread.
- Redeven uses Floret turn rewrites only for opaque product foreign keys and never copies conversation content.
- Secrets, runs, projections, approvals, todos, memory, Floret tool lifecycle state, and Floret internal storage are absent from the Redeven snapshot.
- A destination owned by another operation is a conflict, not a recovery hint.
- A pending operation remains replayable after process restart.
- Floret is consumed only through the published v0.11.2 public runtime API and the Service-owned shared Store.

# References

[1] redeven:internal/ai/threadstore/schema.go:35 - The canonical schema creates durable fork operation storage.
[2] redeven:internal/ai/threadstore/fork_operation.go:52 - Fork snapshot schema v2 contains only product configuration and resource references.
[3] redeven:internal/ai/threadstore/fork_operation.go:392 - Fork commit materializes product data and rewrites opaque resource references.
[4] redeven:internal/ai/thread_fork_operation.go:20 - Redeven resumes one pending operation through Floret and local commit.
[5] redeven:internal/ai/thread_fork_operation.go:130 - Background maintenance replays pending operations in bounded batches.
[6] redeven:internal/ai/threads.go:577 - User-triggered fork prepares the durable operation before calling Floret.
[7] redeven:internal/ai/threadstore/fork_operation_test.go:13 - Reopen tests prove fixed snapshot and committed replay behavior.
[8] redeven:internal/ai/thread_fork_operation_test.go:14 - Process restart tests recover a Floret-completed pending operation.
