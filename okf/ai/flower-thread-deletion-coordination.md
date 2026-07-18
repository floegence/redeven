---
type: AI Persistence Contract
title: Flower thread deletion coordination
description: Durable delete intent removes the canonical Floret thread before host settings and resource ownership, then retries physical cleanup.
tags: [ai, threads, persistence, deletion, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret deletes the canonical Agent thread tree; Redeven deletes host settings, queue/routing/read state, upload ownership, audit-linked product rows, and physical upload files.
- Outcome: one stable delete operation records user intent and replays the same ordered steps after any crash.
- Invariants: resources remain owned while Floret deletion is unconfirmed, and no compensation restores deleted canonical or product data.
- Failure boundary: transient external failures keep the operation pending; invalid durable snapshots become failed; missing Floret state is idempotent only for an already persisted operation.

# Contract

`PrepareThreadDeleteOperation` verifies that settings exist, captures the exact upload cleanup ids and read-state requirement, and inserts one pending operation for the endpoint/thread identity. Preparation does not delete settings, ownership, files, read state, or Floret data. The operation id is stable and the retired-thread trigger prevents later reuse.

Replay has one fixed order:

1. Call Floret `ThreadMaintenanceHost.DeleteThread` for the canonical parent thread tree and durably confirm success. `ErrThreadNotFound` is success only while replaying this persisted delete intent.
2. In one Redeven transaction, mark the captured uploads for deletion, remove thread-scoped settings, queue, routing, transfer/handoff, permission audit ownership, and resource refs, and confirm product-data deletion.
3. Remove user-scoped Flower read state when required and confirm it.
4. Delete physical upload files, finalize upload rows, and confirm file cleanup.

The operation becomes committed only after every required confirmation is durable. A crash after any boundary repeats the same idempotent step. Floret failure leaves settings and resource ownership intact, so a canonical thread never points at a file that Redeven deleted early. File cleanup is last and retryable because physical deletion does not define Agent or host-data authority.

The authenticated DELETE endpoint returns the durable operation result: committed is HTTP 200, retryable pending is HTTP 202 with the stable operation id, busy without force is HTTP 409, an unknown identity is HTTP 404, and a failed operation contract is HTTP 500.

# Boundaries

Delete never queries or edits Floret tables, never calls `CloseSubAgents` as a data-deletion substitute, never restores removed rows, never rebuilds a snapshot from current state, and never treats absence as proof for an unrecorded step.

# Evidence

- `redeven:internal/ai/threadstore/thread_delete_operation.go:57` - Preparation records intent without deleting settings or resources.
- `redeven:internal/ai/thread_delete_operation.go:66` - Replay deletes Floret first, then product state, read state, and files.
- `redeven:internal/ai/threadstore/thread_delete_operation.go:113` - Product deletion requires durable Floret confirmation.
- `redeven:internal/ai/thread_delete_operation_test.go:129` - Restart tests cover every durable step and Floret failure retention.
- `redeven:internal/ai/threadstore/thread_delete_operation_test.go:10` - Store tests cover intent, retirement, and confirmation order.
