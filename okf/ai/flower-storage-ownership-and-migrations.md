---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state; Redeven schema v8 stores host settings, upload staging, immutable unadmitted commands, routing, and audit.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-27T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state. Redeven owns host settings, upload bytes, unadmitted commands, routing/read state, audit, and cross-store operation intent.
- Outcome: schema v8 replaces durable editable drafts with capability-bound upload staging. Editable text, references, and composer preferences exist only in the current connection's Flower coordinator.
- Invariants: connections cannot recover or conflict with each other's drafts; staging rows contain no editable message or reference projection; Send atomically freezes an unadmitted command before Floret admission.
- Failure boundary: unsupported schema, drift, malformed legacy drafts, uncertain canonical reads, membership mismatch, or failed migration effects stop startup without repair or substitute database creation.

# Contract

## Schema v8 ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and settings timestamps. Canonical title, conversation, turn lifecycle, preview, latest turn, approvals, todos, and Agent relationships exist only in Floret.

The shared Flower coordinator stores editable text, ordered references, attachment presentation, and composer overrides in process memory. One shell connection supplies one coordinator to Activity, Workbench, and floating surfaces, so navigation and remounts preserve the same scope without leases or conflict resolution. Another connection receives a different coordinator and never reads that state. Redeven has no composer-draft API, table, revision, lease, holder, takeover, recovery setting, or persistence adapter.

`ai_upload_staging_scopes` stores an opaque scope identity, endpoint, authenticated owner hash, target thread identity, capability hash, creation time, expiry, and release state. The plaintext capability is returned only at creation and is accepted only through the exact staging headers. The scope may retain uploaded bytes while a connection is active, but it stores no prompt text, references, model choice, or UI draft snapshot and cannot hydrate a later connection. Release or expiry removes its claims; last-reference cleanup owns physical deletion.

Clicking Send is the persistence boundary. Redeven validates the current request and atomically converts the selected staging claims into one immutable `ai_queued_turns` command. For a new conversation, the same transaction creates the thread-create operation and settings, freezes the proposed TurnID/RunID and command payload, and transfers attachment claims. Retry with the same exact identity and frozen payload returns the existing operation; a conflicting payload fails without overwriting it. Post-commit recovery and settlement operate on that command, not on an editable draft.

After Floret admits the canonical turn, settlement moves attachment ownership to the thread and removes the command. Restart reconciliation asks public Floret `ReadThreadTurn` for the exact TurnID; only `ErrTurnNotFound` proves absence. Redeven stores no admitted message, reference projection, lifecycle copy, or TurnID-to-entry mapping.

The current-process todo prompt projection contains only typed counts and the Floret todo snapshot version/update round. Removed dialogue pairs, structured-user-input records, loop snapshots, pending tool queues, error queues, progress signatures, objective digests, and estimate-source fields are not Redeven contracts and cannot be reintroduced as declarations or durable JSON keys.

Permission snapshots are append-only audit and pending-approval evidence, not current authority. Current permission comes from `ai_thread_settings.permission_type`; unsupported snapshot versions and malformed data fail closed or are removed only by their declared migration.

Create, fork, delete, and SubAgent publication operations persist only immutable host intent, fingerprints, and step confirmations for cross-store effects. They never store canonical lifecycle, messages, membership, events, or journal-rebuilding results. Pending replay payloads are cleared on commit or terminal failure. Strict JSON, row identity, and fingerprints bind replay; damaged intent is rejected.

## Contiguous migration

Startup verifies database kind, schema shape, closed reference kinds, security rows, and pending operation payloads before any effect. Versions 2 through 8 are supported. Version 2 title migration runs through public Floret APIs before the Redeven SQL migration transaction. Versions 3 through 6 retain their documented product-only migrations. Schema v7 remains a migration input only; production v8 does not expose its draft shape.

The v7-to-v8 preflight reads each legacy admission-in-flight record and classifies its exact proposed TurnID through public Floret authority and the immutable command store before SQLite mutation. A matching queued command preserves its exact command claim. A canonical admitted turn preserves only attachment membership proven by the exact public turn. An exact queue miss plus `ErrTurnNotFound` releases unadmitted staging resources. Uncertain reads, malformed values, ownership or membership mismatch, missing bytes, or digest drift stop migration.

After preflight succeeds, one SQLite transaction applies the fixed decision set, converts or releases every legacy draft claim, drops `ai_composer_drafts`, creates `ai_upload_staging_scopes`, updates schema metadata, and verifies the exact v8 shape. Ordinary and otherwise unadmitted legacy editable drafts are deleted because cross-connection draft recovery is no longer a product behavior. Any failure rolls back to the complete verified v7 database.

Fresh stores initialize directly at schema v8. Another kind, version 0, versions below 2, future versions, malformed metadata, or schema drift are rejected non-destructively. Removed product v1 and canonical v15-v40 paths remain unsupported.

# Boundaries

The repository-wide automatic migration and database ownership contract is defined by [Database schema migration ownership](../architecture/database-schema-migrations.md). Redeven migration code may call only public Floret maintenance APIs and must not inspect or alter Floret storage.

An upload staging scope is a byte-retention capability, not a draft record or authorization for canonical history. Product-local reference chips remain connection memory until Send. After admission, the ordered canonical references and attachment membership come only from Floret public snapshots; paths and opaque resource identities are never filesystem authorization.

The checked-in v2-through-v8 schema manifest is independent of the DDL builders. It freezes every `sqlite_master.sql` row, `table_xinfo`, `index_list`, and `index_xinfo` row, including automatic unique indexes, triggers, CHECK clauses, and UNIQUE clauses. Runtime preflight and final verification compare real historical and fresh databases against that manifest, so a builder cannot redefine its own expected shape. Migration tests additionally require every supported historical schema to reach the exact reviewed current schema.

The repository durable-sink registry is a closed set over production Go, SQL, TypeScript, TSX, Desktop, JSON/file, Web Storage, IndexedDB, and Cache Storage writes. Each discovered sink file is bound to its complete source digest, sink kinds, owner, authority, data classes, and applicable table, key, codec, and DTO inventory. A new sink, changed reviewed file, stale entry, unsupported authority, canonical Agent data class, or shadow table fails the Floret dependency boundary gate. Legal entries remain limited to product configuration and resources, unadmitted command and cross-store coordination, permission/security audit, diagnostics, user effects, upstream adapters, and UI preferences or caches.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Threadstore declares schema v8, the contiguous migration chain, and fresh staging-scope storage without composer drafts.
- `redeven:internal/ai/threadstore/legacy_composer_migration.go` - Legacy v7 draft decoding is isolated to migration.
- `redeven:internal/ai/threadstore/product_migrations.go` - The v7-to-v8 transaction applies preflight decisions and removes legacy draft ownership.
- `redeven:internal/ai/threadstore/upload_staging.go` - Capability-hash authorization, staging claims, release, and claim transfer are transactional.
- `redeven:internal/ai/threadstore/thread_create_operation.go` - New-thread settings, immutable initial command, create operation, and staging claim transfer freeze atomically.
- `redeven:internal/ai/initial_turn.go` - The service uses the frozen initial-turn transaction before canonical admission.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Editable composer scopes are connection-local memory shared by shell surfaces.
- `redeven:internal/ai/threadstore/schema_v6_test.go` - Fresh v8 tests enforce staging-scope presence and composer-draft absence.
- `redeven:internal/ai/threadstore/schema_migration_test.go` - Migration tests enforce contiguous upgrades, rollback, drift rejection, and unsupported-version rejection.
- `redeven:internal/ai/threadstore/reviewed_schema_manifest.json` - Static v2-through-v8 SQLite object, column, index, trigger, CHECK, and UNIQUE contracts.
- `redeven:internal/ai/threadstore/reviewed_schema_test.go` - Fresh, historical, migration-equivalence, constraint-drift, and index-drift checks.
- `redeven:internal/ai/agent_shadow_boundary_test.go` - AST and reflection checks reject removed Agent contracts and durable shadow state.
- `redeven:scripts/contracts/durable_sink_registry.json` - Reviewed closed inventory of production durable sink files and their ownership metadata.
- `redeven:internal/boundarycontract/durable_sinks.go` - Cross-language discovery, exact digest enforcement, and forbidden authority validation.
- `redeven:scripts/check_floret_dependency_boundary.sh` - The boundary gate rejects Floret storage access, local dependency wiring, and durable sinks outside the reviewed closed set.
