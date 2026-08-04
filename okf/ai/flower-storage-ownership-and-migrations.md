---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns canonical Agent state; Redeven product v1 stores only host resources, unadmitted work, authorization evidence, and coordination receipts.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-31T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state and canonical identities; Redeven owns product settings, uploads, unadmitted queue state, routing, authorization evidence, and durable cross-store operations.
- Outcome: `ai_threadstore_product_v1` version 1 is the sole first-release baseline and opens only after a read-only complete-schema preflight.
- Invariants: admission identities begin empty, bind once from the published Floret v3.2.13 admission receipt, and settle product state atomically. Unsupported databases are rejected without mutation. Observation events are never an admission bind boundary.
- Failure boundary: schema drift, an unsupported identity, incomplete canonical evidence, or a conflicting replay stops startup or admission without repair, reset, or substitute state.

# Contract

## First-release schema

The Redeven AI product database has kind `ai_threadstore_product_v1`, current version 1, minimum version 1, one current initializer, and no historical migrations. The initializer directly creates the reviewed current tables, indexes, triggers, constraints, and metadata. It does not build a discarded shape and alter it forward.

This is a one-time, user-approved pre-launch baseline reset. The project had not been released or distributed with the discarded product schemas, so their migration code, compatibility readers, legacy composer/title paths, upload fallbacks, and migration fixtures are removed. An existing `ai_threadstore_product_v2` database, version 0, a future or unknown version, another kind, malformed metadata, or any shape drift is unsupported.

Before writable SQLite open, WAL configuration, or sidecar creation, threadstore classifies the path with an existing-only read-only connection. Missing and zero-byte files may proceed to initialization. A current file must match the checked-in reviewed snapshot across schema kind/version, `sqlite_master`, columns, indexes, foreign keys, triggers, and covered metadata planes. Every unsupported file is rejected before writable open; its bytes, size, timestamps, metadata, and existing or absent `-wal` and `-shm` sidecars remain unchanged.

## Product ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission, working directory, pin state, queue revision, audit identity, and product timestamps. Upload tables store immutable bytes, digests, text metadata when applicable, owner-scoped claims, thread references, and short-lived staging scopes. Product operation tables store immutable inputs, fingerprints, stable `client_request_id` and Floret `LogicalRequestID` values, nullable canonical bindings, materialization stages, and minimal recovery evidence.

No Redeven table stores admitted message bodies, assistant projection, canonical title, Agent lifecycle, approvals, todos, tool state, SubAgent membership, provider continuation, or a second queryable turn history. Permission snapshots and admission receipts are product authorization and settlement evidence, not an alternate Agent lifecycle.

New-conversation staging binds a neutral product `target_id` derived from the stable client request scope. Create and fork operations begin without a canonical destination. Once Floret returns its canonical identity, Redeven compare-and-set binds it and atomically materializes settings, upload claims, initial queued work, routing, and staging ownership. A replay with the same fingerprint must converge on the same identity; a conflicting result fails closed.

Queued work begins with only `queue_id`; `turn_id` and `run_id` are null. Admission freezes a command fingerprint and stable `LogicalRequestID`. Redeven calls the published Floret v3.2.13 `AdmitTurn` API first, validates the returned `TurnAdmissionReceipt`, and then binds the previously empty canonical IDs, committed user entry, permission-snapshot evidence, upload ownership, queued-work consumption, and followup revision in one threadstore transaction. Only after this settlement is committed does Redeven publish the canonical timeline and call receipt-only `ExecuteAdmission` with process-local supplemental context. Floret retains the immutable execution plan; Redeven does not persist another command copy for execution recovery. Observation events remain rendering and diagnostic input only; they cannot bind admission or complete the product admission wait.

When a retry receives a committed, replayed Floret mutation receipt without another event, recovery must exact-read the canonical turn and user entry. It validates request, thread, turn, run, entry, normalized command fingerprint, and permission proof before invoking the same receipt binder. Missing or conflicting evidence cannot release the command, invent identity, or rebuild canonical history.

## Future automatic migrations

After this v1 baseline is merged and released or distributed, every product schema change must retain kind `ai_threadstore_product_v1`, increment the version by one, and add every contiguous `n -> n+1` migration. Each edge must verify an exact reviewed source snapshot before mutation and the exact reviewed target snapshot afterward. Schema changes, transformed data, `PRAGMA user_version`, product metadata, and final verification commit atomically; failure rolls back to the last supported database.

A future change may not reset the kind, raise the minimum version, remove a required migration, or invoke pre-launch status to avoid upgrading distributed data. Migration tests must cover every supported edge, user-data preservation, rollback, drift rejection, and future-version rejection.

# Boundaries

Floret v3.2.13 owns its database and opens it through published runtime APIs. Before publishing a usable Host, the upstream runtime automatically migrates the released domain schema v2 through v3 to current v4 in one backend transaction. The v3-to-v4 edge derives the strict root-thread inventory from canonical authority and commits both records atomically; current startup decodes the full domain once and verifies exact inventory agreement. Fresh and current stores open at v4, repeated startup is idempotent, and write failure, cancellation, panic, drift, or future state rolls back or fails closed. Canonical reads also project supported interrupted approval history into a coherent terminal state. Redeven neither inspects nor migrates Floret tables and has no `PreflightV2Migration`, `ApplyV2Migration`, `ErrMigrationRequired`, or `storage.MigrateV2` compatibility path.

The checked-in reviewed schema manifest contains exactly the current product v1 snapshot and is independent of the initializer. The threadstore boundary manifest assigns every schema object and all production SQL call sites to reviewed owner, action, structured consumer-kind, table, lookup-key, and read/write-column contracts, including explicit closed sets for dynamic SQL and admission-receipt access. The durable-sink registry remains a closed, digest-bound inventory of production persistence surfaces. All three artifacts are verified in the dependency boundary gate.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Declares the version 1 current initializer and product-only constraints.
- `redeven:internal/ai/threadstore/store.go` - Classifies existing files read-only before writable open.
- `redeven:internal/ai/threadstore/store_meta_test.go` - Verifies unsupported databases are rejected without mutation.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Freezes the sole current v1 schema snapshot.
- `redeven:internal/ai/threadstore/reviewed_schema_test.go` - Enforces complete current-shape and metadata-plane drift detection.
- `redeven:scripts/contracts/threadstore_boundary_manifest.json` - Records table ownership, consumer restrictions, lookup keys, retention, and the complete production SQL catalog.
- `redeven:okf/ai/flower-cross-store-mutation-inventory.md` - Records every cross-store mutation family and the v3.2.13 receipt-based admission boundary.
- `redeven:internal/ai/threadstore/thread_create_operation.go` - Persists stable create identity, nullable canonical binding, and product materialization stages.
- `redeven:internal/ai/threadstore/fork_operation.go` - Persists the durable fork saga and canonical destination binding.
- `redeven:internal/ai/threadstore/followups.go` - Owns queue admission state and durable admission receipts.
- `redeven:internal/ai/floret_runtime.go` - Binds queued admission from `TurnAdmissionReceipt` before execution and leaves events observational.
- `redeven:internal/ai/queued_turns.go` - Replays admission through the same logical request and strict exact-read recovery.
- `redeven:scripts/contracts/durable_sink_registry.json` - Records the reviewed product persistence closed set.
- `redeven:scripts/check_floret_dependency_boundary.sh` - Rejects shadow state, Floret schema access, and unreviewed persistence.
