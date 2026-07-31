---
type: Boundary Inventory
title: Flower cross-store mutation inventory
description: Reviewed commit points, legal Redeven state, recovery entry points, and unresolved public-contract gaps for every Floret/Redeven mutation family.
tags: [ai, floret, boundary, saga, recovery]
timestamp: 2026-07-31T00:00:00Z
---
# Decision

Floret is authoritative for every admitted Agent fact. Redeven records only product resources, authorization, unadmitted work, and the minimum coordination evidence needed to settle a mutation across two independent stores. A Redeven record never proves canonical lifecycle state and cannot be used for lifecycle inventory, timeline, status, or search.

The v3.0.2 turn path still discovers the canonical admission through an observation callback. `EventSink.EmitEvent` cannot report a bind failure to Floret, and an event can be lost after the Floret commit. The current replay path reduces this risk but does not provide a durable public admission acknowledgement before provider execution. This is a confirmed product-neutral Floret contract gap and requires Phase 1B's explicit two-stage admission API; it cannot be closed inside Redeven Phase 1A.

# Inventory

| Mutation | Floret canonical commit | Legal Redeven state | Restart entry and convergence rule | Phase 1A result |
| --- | --- | --- | --- | --- |
| Root thread creation | `CreateThread` receipt and canonical root | `ai_thread_create_operations`, product settings, routing, upload claims | Replay the same logical request, bind the returned ThreadID once, then resume product materialization | Existing durable coordinator is legal; crash matrix remains Phase 1C work |
| Thread fork | `ForkThread` receipt and canonical fork origin | `ai_thread_fork_operations`, destination settings/routing/upload claims | Replay exact logical request and bind returned destination once | Existing durable coordinator is legal; crash matrix remains Phase 1C work |
| Thread deletion | Floret deleted lifecycle | `ai_thread_delete_operations` and product resource-cleanup flags | Exact-read canonical authority, then resume idempotent product cleanup | Local tombstone is not canonical deletion status |
| Turn admission | canonical user entry and Turn/Run/Entry identity | `ai_queued_turns`, `ai_turn_admission_receipts`, permission snapshot, upload settlement | v3.0.2 replays the same request and exact-reads the returned turn before binding; Phase 1C must consume the Phase 1B admission receipt directly | Observation-based acknowledgement is insufficient and triggers Phase 1B |
| SubAgent spawn/publication | child Thread, origin, and publication lifecycle | `ai_subagent_publication_operations` and child permission evidence | Replay exact child mutation and use public child exact reads before local publication settlement | Legal coordination only; no child transcript or lifecycle copy |
| Approval decision | canonical approval request and decision | product authorization basis and security audit only | Exact-read current approval and replay the public decision command under its expected generation/revision | No Redeven approval lifecycle table is permitted |
| Pending tool settlement | canonical invocation, effect proof, and result | external-effect audit and host resource handle only | Reopen the bound Floret pending-tool recovery capability and settle the same proof; never execute an unknown effect twice | No tool-call/result ledger is permitted in Redeven |
| Artifact/resource publication | canonical Artifact or message reference | physical upload object, claims, staging scope, and cleanup attempt | Resolve the opaque canonical reference under current authorization; physical cleanup must not mutate canonical membership | Upload tables cannot rebuild message membership |

# Machine-Enforced Evidence

- `internal/ai/threadstore/reviewed_schema_manifest.json` freezes the complete physical schema: version, tables, columns, indexes, triggers, constraints, and SQL.
- `scripts/contracts/threadstore_boundary_manifest.json` assigns every physical table, inherited column/index/trigger, and every production SQL call site to a reviewed owner and consumer contract.
- Stable query IDs bind path, receiver/function, SQL method, normalized SQL or rendered expression, action, structured consumer kind, tables, lookup keys, read/write columns, and the full reviewed builder closure for dynamic statements. The catalog currently covers 238 production calls across threadstore and its shared SQLite engine. A source change produces an unreviewed ID or fingerprint and fails CI; non-PRAGMA DML without an owned table, or INSERT/UPDATE without reviewed write columns, is rejected.
- Dynamic SQL is fail closed. The only exceptions are the explicitly enumerated placeholder batches, constant projections, quoted schema introspection, bounded PRAGMA, and closed enum/branch statements recorded in the catalog.
- `ai_turn_admission_receipts` access is an exact query-ID/action/consumer-kind closed set limited to admission coordination, its schema maintenance, and startup recovery. Reads are restricted to exact `queue_id` coordination. `logical_request_id` is allowed for exact coordination as Phase 1C adopts the released Floret API. Canonical-ID indexes are integrity-only and do not authorize reads.
- `terminal_committed` and `terminal_replayed` have no production consumer. Phase 1C must remove them in the required product schema migration; canonical receipt indexes must be retained only if their integrity value is proven.
- `scripts/check_floret_dependency_boundary.sh --ci` runs both the durable-sink closed set and the threadstore schema/query contract.

# Recovery Invariants

1. A Floret commit is recovered only by the same logical request receipt or a public exact read.
2. Conflicting proof, fingerprint, identity, or stage fails closed; no history scan or audit reconstruction is allowed.
3. External effects with unknown or committed outcomes are settled from durable proof and are never blindly repeated.
4. Deleting expired coordination evidence cannot delete or make Floret canonical state unreadable.
5. Phase 1C must add deterministic subprocess checkpoints and oracles for every inventory row before the boundary can be signed at runtime.

# Evidence Links

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
