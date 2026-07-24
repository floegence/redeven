---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state; Redeven schema v6 stores host settings, drafts, resources, queue state, routing, and audit.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state; Redeven owns host settings, unadmitted work, upload storage, routing/read state, security audit, and cross-store operation intent.
- Outcome: schema v6 adds revisioned composer drafts to host settings, routing, queue state, and owner-scoped attachments without copying canonical Agent state.
- Invariants: migration accepts only verified product schemas v2 through v6; Floret title migration for v2 runs before the Redeven SQL migration transaction.
- Failure boundary: title conflicts, unsupported kind/version, schema drift, invalid records, and failed Floret calls stop startup without repair, backup, reset, or substitute database creation.

# Contract

## Schema v6 ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and settings timestamps. Canonical title, lifecycle, preview, latest turn, and Agent relationships exist only in Floret. Upload rows and files remain Redeven resources. Before admission, `ai_upload_refs` binds uploads to one queued command. Its admission state is `ready` or immutable `in_flight`; bulk draft recovery excludes the latter. Admission atomically settles command and upload ownership. A known pre-admission failure releases the command as a draft. Startup may return a crash-interrupted command to `ready` only after public Floret reads prove its exact TurnID was not admitted. Redeven stores no admitted TurnID/RunID lifecycle or message mapping, so a missing settlement row is an error.

`ai_composer_drafts` stores one unadmitted product draft per exact `(endpoint_id, owner_user_hash, scope_id)`. Its strict JSON snapshot, monotonic revision, expiring editor lease, update time, and 30-day expiry are Redeven coordination state, not message history. Upload completion creates only an owner-bound `draft_pending` claim. An exact lease and revision mutation atomically promotes selected claims to `draft`, removes claims no longer present, and updates the ordered snapshot. Admission atomically validates text, model, proposed TurnID, attachment order, owner, and revision before moving claims to a queued command and deleting the draft row.

New-thread admission first binds one generated target thread id into the draft with revision CAS, then uses the existing durable create operation. Retry reuses that target. An expired admission lease remains protected until exact queued state and public Floret turn reads reconcile its proposed TurnID. Positive evidence clears the draft; an exact miss resets pre-admission state; read or pagination uncertainty preserves it. Thread deletion releases the deleted thread's claims and every owner-isolated draft in that thread scope, while retaining resources referenced by another thread, fork, queue, or draft.

Permission snapshots are append-only audit and pending-approval evidence, not current authority. Current permission comes from `ai_thread_settings.permission_type`; unsupported snapshot versions and malformed data fail closed or are removed only by their declared migration.

Create, fork, delete, and SubAgent publication operations persist only immutable host intent, fingerprints, and step confirmations for cross-store effects. They never store canonical lifecycle, messages, membership, events, or journal-rebuilding results. Pending replay payloads are cleared on commit or terminal failure. Strict JSON, row identity, and fingerprints bind replay; damaged intent is rejected.

## Product v2 and v3 to v4

Startup verifies database kind, schema shape, closed reference kinds, security rows, and pending operation payloads before any effect. Only versions 2 through 6 are supported. Version 2 alone may contain titles: after closing its read transaction, migration compares each title through public Floret APIs, writes only an empty canonical title, accepts an equal title, and stops on conflict. Versions 3 through 6 contain no title copy and make no Floret write during preflight.

Only after every v2 title succeeds does one SQLite transaction rebuild host settings, remove title ownership, normalize upload claims, introduce admission and durable operation state, fingerprint pending intent, and retain supported permission evidence.

The v3-to-v4 step retains only non-empty product routing and removes Agent owner, parent, context, action, transfer, and handoff shadows rather than renaming them behind a compatibility reader. Every step and final version commit atomically; a crash leaves the previous verified version for retry.

Schema v5 rebuilds upload resources around stable user ownership, server-only storage names, immutable digest and text statistics, source, state, idempotent upload attempts, and closed legacy scopes. Only existing live resources with exact thread claims become `legacy_thread`; queued-only, staged, and staged-with-thread-claim records become `legacy_staged_quarantine`. Migration never invents a stable user hash from transient legacy fields. Detailed resource authorization and retention are owned by [Flower attachment resources](flower-attachment-resources.md).

Schema v6 adds the composer draft table, its expiry index, and the closed `draft_pending` reference kind. It does not copy admitted text or attachment membership. Existing schema-v5 resources retain their exact ownership and claims. User-owned legacy draft claims gain the authenticated-owner-bound internal ref identity, while `legacy_thread` and `legacy_staged_quarantine` claims retain their closed legacy ref identity and gain only their lifecycle scope index; migration neither invents a user owner nor creates a composer draft for them. Fresh draft claims are always derived from the authenticated user and draft scope.

Fresh stores initialize directly at schema v6; verified older databases run every contiguous migration. Another kind, version 0, versions below 2, future versions, malformed metadata, or schema drift are rejected non-destructively. Removed product v1 and canonical v15-v40 paths are unsupported.

# Boundaries

The repository-wide automatic migration and database ownership contract is
defined by [Database schema migration ownership](../architecture/database-schema-migrations.md).
This concept defines the Flower-specific cross-owner exception and does not
grant Redeven authority over Floret's database schema.

Redeven migration code may call only public Floret maintenance APIs and may retain only host settings, resources, queue state, routing/read state, audit, and operation intent. It must not query Floret SQLite, infer canonical data from old Redeven rows, or keep legacy aliases and compatibility parsers after conversion to v4.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Threadstore declares product schema version 6 and its host-only tables.
- `redeven:internal/ai/threadstore/schema_preflight.go` - Startup accepts only verified supported versions and reads version-2 titles outside the SQL migration transaction.
- `redeven:internal/ai/service.go:270` - Service startup supplies the Floret public title migration callback.
- `redeven:internal/ai/service.go:289` - Title preflight compares and writes through Floret public APIs before opening the product store.
- `redeven:internal/ai/threadstore/product_migrations.go` - Contiguous migrations retain product routing, remove Agent shadows, and migrate upload ownership without guessing.
- `redeven:internal/ai/threadstore/schema_v6_test.go` - Tests verify fresh stores and the v5-to-v6 draft migration preserve product records.
- `redeven:internal/ai/threadstore/composer_drafts_test.go` - Tests enforce lease, revision, claim promotion, expiry, deletion, and reconciliation boundaries.
- `redeven:internal/ai/threadstore/schema_migration_test.go` - Tests verify title/routing/ownership migration, rollback, schema drift rejection, and unsupported version rejection.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - Static checks reject Floret storage access and local dependency wiring.
