---
type: Storage Contract
title: Flower storage ownership and migrations
description: Floret owns Agent state; Redeven schema v7 stores host settings, drafts, resources, queue state, routing, and audit.
tags: [ai, storage, sqlite, migrations, floret]
timestamp: 2026-07-27T00:00:00Z
---
# Summary

- Authority: Floret owns admitted Agent state; Redeven owns host settings, unadmitted work, upload storage, routing/read state, security audit, and cross-store operation intent.
- Outcome: schema v6 adds revisioned composer drafts; schema v7 makes their ordered reference array explicit without copying canonical Agent state.
- Invariants: migration accepts only verified product schemas v2 through v7; fresh product tables and thread-setting columns are closed allowlists; Floret title migration for v2 runs before the Redeven SQL migration transaction.
- Failure boundary: title conflicts, unsupported kind/version, schema drift, invalid records, and failed Floret calls stop startup without repair, backup, reset, or substitute database creation.

# Contract

## Schema v7 ownership

`ai_thread_settings` stores endpoint, namespace, model, reasoning, permission type, working directory, pin state, queue revision, host audit identity, and settings timestamps. Canonical title, lifecycle, preview, latest turn, and Agent relationships exist only in Floret. Upload rows and files remain Redeven resources. Before admission, `ai_upload_refs` binds uploads to one queued command. Its admission state is `ready` or immutable `in_flight`; bulk draft recovery excludes the latter. Admission atomically settles command and upload ownership. A known pre-admission failure releases the command as a draft. Startup may return a crash-interrupted command to `ready` only after public Floret reads prove its exact TurnID was not admitted. Redeven stores no admitted TurnID/RunID lifecycle or message mapping, so a missing settlement row is an error.

The current-process todo prompt projection contains only typed counts and the Floret todo snapshot version/update round. It has no JSON tags or durable representation. Removed dialogue pairs, structured-user-input records, loop snapshots, pending tool queues, error queues, progress signatures, objective digests, and estimate-source fields are not Redeven contracts and cannot be reintroduced as declarations or durable JSON keys.

`ai_composer_drafts` stores one unadmitted product draft per exact `(endpoint_id, owner_user_hash, scope_id)`. Its strict JSON snapshot, monotonic revision, expiring editor lease, update time, and 30-day expiry are Redeven coordination state, not message history. The snapshot contains ordered file/directory reference chips with a product-local identity, a server-derived path label, and an opaque normalized path. Reference selection and removal use the same exact lease/revision mutation as text and attachments; duplicate local identities, duplicate kind/path pairs, unknown fields or kinds, malformed paths, and client-defined labels are rejected. Draft read, lease, and mutation remain available whenever the Redeven AI service and threadstore have started; they do not require a configured model profile. Only thread preparation and turn admission require usable model capability. Upload completion creates only an owner-bound `draft_pending` claim. An exact lease and revision mutation atomically promotes selected claims to `draft`, removes claims no longer present, and updates the ordered snapshot. Admission atomically validates text, model, proposed TurnID, attachment order, owner, revision, and the ordered reference `(path, is_directory)` projection against the same strict `flower_composer` context-action JSON before moving claims to a queued command and deleting the draft row. A mismatch has no draft, upload-claim, queue, or canonical Floret side effect.

New-thread admission first binds one generated target thread id into the draft with revision CAS, then uses the existing durable create operation. Retry reuses that target. An expired admission lease remains protected until exact queued state and public Floret turn reads reconcile its proposed TurnID. Positive evidence clears the draft; an exact miss resets pre-admission state; read or pagination uncertainty preserves it. Thread deletion releases the deleted thread's claims and every owner-isolated draft in that thread scope, while retaining resources referenced by another thread, fork, queue, or draft.

Permission snapshots are append-only audit and pending-approval evidence, not current authority. Current permission comes from `ai_thread_settings.permission_type`; unsupported snapshot versions and malformed data fail closed or are removed only by their declared migration.

Create, fork, delete, and SubAgent publication operations persist only immutable host intent, fingerprints, and step confirmations for cross-store effects. They never store canonical lifecycle, messages, membership, events, or journal-rebuilding results. Pending replay payloads are cleared on commit or terminal failure. Strict JSON, row identity, and fingerprints bind replay; damaged intent is rejected.

## Product v2 and v3 to v4

Startup verifies database kind, schema shape, closed reference kinds, security rows, and pending operation payloads before any effect. Only versions 2 through 7 are supported. Version 2 alone may contain titles: after closing its read transaction, migration compares each title through public Floret APIs, writes only an empty canonical title, accepts an equal title, and stops on conflict. Versions 3 through 7 contain no title copy and make no Floret write during preflight.

Only after every v2 title succeeds does one SQLite transaction rebuild host settings, remove title ownership, normalize upload claims, introduce admission and durable operation state, fingerprint pending intent, and retain supported permission evidence.

The v3-to-v4 step retains only non-empty product routing and removes Agent owner, parent, context, action, transfer, and handoff shadows rather than renaming them behind a compatibility reader. Every step and final version commit atomically; a crash leaves the previous verified version for retry.

Schema v5 rebuilds upload resources around stable user ownership, server-only storage names, immutable digest and text statistics, source, state, idempotent upload attempts, and closed legacy scopes. Only existing live resources with exact thread claims become `legacy_thread`; queued-only, staged, and staged-with-thread-claim records become `legacy_staged_quarantine`. Migration never invents a stable user hash from transient legacy fields. Detailed resource authorization and retention are owned by [Flower attachment resources](flower-attachment-resources.md).

Schema v6 adds the composer draft table, its expiry index, and the closed `draft_pending` reference kind. It does not copy admitted text or attachment membership. Existing schema-v5 resources retain their exact ownership and claims. User-owned legacy draft claims gain the authenticated-owner-bound internal ref identity, while `legacy_thread` and `legacy_staged_quarantine` claims retain their closed legacy ref identity and gain only their lifecycle scope index; migration neither invents a user owner nor creates a composer draft for them. Fresh draft claims are always derived from the authenticated user and draft scope.

Schema v7 validates every schema-v6 composer draft value through the closed legacy shape, preserves its text, mode, attachment order, admission identity, model and capability fields, and atomically adds `references: []`. Unknown fields, invalid legacy draft values, schema drift, or a failed rewrite roll back the complete migration. The runtime accepts only the v7 shape after startup; it does not keep an optional-field parser or mutate draft JSON during ordinary reads.

Fresh stores initialize directly at schema v7; verified older databases run every contiguous migration. Another kind, version 0, versions below 2, future versions, malformed metadata, or schema drift are rejected non-destructively. Removed product v1 and canonical v15-v40 paths are unsupported.

# Boundaries

The repository-wide automatic migration and database ownership contract is
defined by [Database schema migration ownership](../architecture/database-schema-migrations.md).
This concept defines the Flower-specific cross-owner exception and does not
grant Redeven authority over Floret's database schema.

Redeven migration code may call only public Floret maintenance APIs and may retain only host settings, resources, queue state, routing/read state, audit, and operation intent. It must not query Floret SQLite, infer canonical data from old Redeven rows, or keep legacy aliases and compatibility parsers after conversion to v4.

Draft references exist only before admission and do not create a Redeven copy of admitted message references. The product-local chip identity and label support draft editing but are not admission authority; the server compares only ordered normalized path and directory kind, derives the canonical display label, and hands the accepted reference to Floret. A path is not filesystem authorization, and the draft store must not resolve, read, or persist file contents for it.

Fresh product stores have an exact reviewed table inventory, and `ai_thread_settings` has an exact reviewed column inventory. Any additional table or setting column is a boundary change that must fail the schema ownership test until its product responsibility is reviewed. AST and reflection checks separately keep removed Agent-shaped declarations, serialization tags, and durable shadow JSON keys out of production code while allowing current-process diagnostics.

# Evidence

- `redeven:internal/ai/threadstore/schema.go` - Threadstore declares product schema version 7 and its host-only tables.
- `redeven:internal/ai/threadstore/schema_preflight.go` - Startup accepts only verified supported versions and reads version-2 titles outside the SQL migration transaction.
- `redeven:internal/ai/service.go:270` - Service startup supplies the Floret public title migration callback.
- `redeven:internal/ai/service.go:289` - Title preflight compares and writes through Floret public APIs before opening the product store.
- `redeven:internal/ai/threadstore/product_migrations.go` - Contiguous migrations retain product routing, remove Agent shadows, and migrate upload ownership without guessing.
- `redeven:internal/ai/threadstore/schema_v6_test.go` - Tests verify the v5-to-v6 draft-table migration preserves product records.
- `redeven:internal/ai/threadstore/schema_v7_test.go` - Tests verify fresh stores and the v6-to-v7 reference-array migration preserve valid draft state and roll back invalid input.
- `redeven:internal/ai/threadstore/store_test.go` - Fresh-store tests enforce exact product table and thread-setting column allowlists and reject shadow extensions.
- `redeven:internal/ai/threadstore/composer_drafts_test.go` - Tests enforce lease, revision, claim promotion, expiry, deletion, and reconciliation boundaries.
- `redeven:internal/ai/threadstore/composer_reference_admission_test.go` - Tests enforce strict draft reference shape and atomic ordered-reference admission comparison.
- `redeven:internal/ai/context_action.go` - The product action validator restricts `flower_composer` to normalized file-path items with server-derived labels.
- `redeven:internal/ai/threadstore/schema_migration_test.go` - Tests verify title/routing/ownership migration, rollback, schema drift rejection, and unsupported version rejection.
- `redeven:internal/ai/agent_shadow_boundary_test.go` - AST and reflection checks reject removed Agent contracts and lock the non-serialized todo projection shape.
- `redeven:scripts/check_floret_dependency_boundary.sh:1` - The boundary gate rejects Floret storage/local wiring and runs the semantic Agent-shadow and schema allowlist tests.
