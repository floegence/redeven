---
type: Boundary Inventory
title: Flower cross-store mutation inventory
description: Reviewed commit points, legal Redeven state, recovery entry points, and published receipt boundaries for every Floret/Redeven mutation family.
tags: [ai, floret, boundary, saga, recovery]
timestamp: 2026-07-31T00:00:00Z
---
# Summary

Floret is authoritative for every admitted Agent fact. Redeven records only product resources, authorization, unadmitted work, and the minimum coordination evidence needed to settle a mutation across two independent stores. Redeven evidence never proves canonical lifecycle state or supports lifecycle inventory, timeline, status, or search. Turn admission now binds from the published Floret v3.2.1 `TurnAdmissionReceipt` before execution; recovery accepts only the same logical-request receipt or a public exact read, and conflicting or incomplete proof fails closed.

# Contract

## Admission acknowledgement

The published Floret v3.2.1 turn path separates admission from execution. Redeven first calls `AdmitTurn`, validates the returned `TurnAdmissionReceipt`, settles its product coordination transaction, publishes the canonical user timeline, and only then calls `ExecuteAdmission` with the same receipt plus ephemeral `ExecutionContext`. The canonical command is fixed by Floret admission and is not persisted or resubmitted as a Redeven execution plan. `EventSink.EmitEvent` remains fail-closed observation: committed-user events may validate identity and later presentation, but they cannot bind admission, complete admission waiting, or substitute for the receipt.

## Mutation inventory

| Mutation | Floret canonical commit | Legal Redeven state | Restart entry and convergence rule | Phase 1A result |
| --- | --- | --- | --- | --- |
| Root thread creation | `CreateThread` receipt and canonical root | `ai_thread_create_operations`, product settings, routing, upload claims | Replay the same logical request, bind the returned ThreadID once, then resume product materialization | Existing durable coordinator is legal; remaining crash-matrix oracles are future hardening |
| Thread fork | `ForkThread` receipt and canonical fork origin | `ai_thread_fork_operations`, destination settings/routing/upload claims | Replay exact logical request and bind returned destination once | Existing durable coordinator is legal; remaining crash-matrix oracles are future hardening |
| Thread deletion | Floret deleted lifecycle | `ai_thread_delete_operations` and product resource-cleanup flags | Exact-read canonical authority, then resume idempotent product cleanup | Local tombstone is not canonical deletion status |
| Turn admission | canonical user entry and Turn/Run/Entry identity plus immutable execution plan | `ai_queued_turns`, `ai_turn_admission_receipts`, permission snapshot, upload settlement | Call `AdmitTurn`, bind the `TurnAdmissionReceipt`, then call `ExecuteAdmission` with ephemeral execution context; replay exact reads only to verify committed receipt evidence | Receipt-based acknowledgement is consumed; observation is diagnostic only |
| SubAgent spawn/publication | child Thread, origin, and publication lifecycle | `ai_subagent_publication_operations` and child permission evidence | Replay exact child mutation and use public child exact reads before local publication settlement | Legal coordination only; no child transcript or lifecycle copy |
| Approval decision | canonical approval request and decision | product authorization basis and security audit only | Exact-read current approval and replay the public decision command under its expected generation/revision | No Redeven approval lifecycle table is permitted |
| Pending tool settlement | canonical invocation, effect proof, and result | external-effect audit and host resource handle only | Reopen the bound Floret pending-tool recovery capability and settle the same proof; never execute an unknown effect twice | No tool-call/result ledger is permitted in Redeven |
| Artifact/resource publication | canonical Artifact or message reference | physical upload object, claims, staging scope, and cleanup attempt | Resolve the opaque canonical reference under current authorization; physical cleanup must not mutate canonical membership | Upload tables cannot rebuild message membership |

## Machine-enforced contract

- `internal/ai/threadstore/reviewed_schema_manifest.json` freezes the complete physical schema: version, tables, columns, indexes, triggers, constraints, and SQL.
- `scripts/contracts/threadstore_boundary_manifest.json` assigns every physical table, inherited column/index/trigger, and every production SQL call site to a reviewed owner and consumer contract.
- Stable query IDs bind path, receiver/function, SQL method, normalized SQL or rendered expression, action, structured consumer kind, tables, lookup keys, read/write columns, and the full reviewed builder closure for dynamic statements. The catalog currently covers 238 production calls across threadstore and its shared SQLite engine. A source change produces an unreviewed ID or fingerprint and fails CI; non-PRAGMA DML without an owned table, or INSERT/UPDATE without reviewed write columns, is rejected.
- Dynamic SQL is fail closed. The only exceptions are the explicitly enumerated placeholder batches, constant projections, quoted schema introspection, bounded PRAGMA, and closed enum/branch statements recorded in the catalog.
- `ai_turn_admission_receipts` access is an exact query-ID/action/consumer-kind closed set limited to admission coordination, its schema maintenance, and startup recovery. Reads are restricted to exact `queue_id` coordination. `logical_request_id` is allowed only for exact published Floret receipt coordination. Canonical-ID indexes are integrity-only and do not authorize reads.
- The admission receipt schema stores no terminal outcome fields. Canonical receipt indexes remain integrity-only and do not authorize lookup or presentation.
- `scripts/check_floret_dependency_boundary.sh --ci` runs both the durable-sink closed set and the threadstore schema/query contract.

# Boundaries

## Recovery invariants

1. A Floret commit is recovered only by the same logical request receipt or a public exact read.
2. Conflicting proof, fingerprint, identity, or stage fails closed; no history scan or audit reconstruction is allowed.
3. External effects with unknown or committed outcomes are settled from durable proof and are never blindly repeated.
4. Deleting expired coordination evidence cannot delete or make Floret canonical state unreadable.
5. Deterministic subprocess checkpoints and oracles remain required before every inventory row can be signed as runtime-complete.

# Evidence

- `redeven:internal/ai/thread_create_operation.go`
- `redeven:internal/ai/thread_fork_operation.go`
- `redeven:internal/ai/thread_delete_operation.go`
- `redeven:internal/ai/floret_runtime.go`
- `redeven:internal/ai/subagent_publication_recovery.go`
- `redeven:internal/ai/floret_approval.go`
- `redeven:internal/ai/terminal_process_service.go`
- `redeven:internal/ai/upload_lifecycle.go`
- `redeven:internal/ai/threadstore/reviewed_schema_test.go`
- `redeven:internal/boundarycontract/threadstore_sql.go`
