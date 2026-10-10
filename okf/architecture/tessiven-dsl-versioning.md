---
type: Architecture Contract
title: Tessiven DSL versioning
description: Select exact frozen DSL schemas and migrate supported documents without rewriting history.
tags: [architecture, tessiven, compatibility]
timestamp: 2026-10-10T00:00:00Z
---
# Summary

The Runtime owns Tessiven DSL schema selection and explicit forward migrations.
New documents use `apiVersion: redeven.io/tessiven/v1.0.0`. Supported legacy
`redeven.io/tessiven/v1` remains readable through a reviewed `v1 -> v1.0.0`
upgrade. Reads project current structured data while preserving historical YAML,
digest and revision identity. Authorized edits save a new current snapshot.
Unknown versions, invalid source/target documents or migration failures leave
stored data intact; users need a compatible Runtime or a valid repair.

# Version Identities And Releases

DSL identities use stable `vMAJOR.MINOR.PATCH` strings, for example `v1.2.3`.
The version is the suffix of `apiVersion`; it is independent of Runtime releases,
canvas revision numbers and SQLite schema versions. The pre-semver `v1` alias
is an exact frozen legacy format, not a range covering all 1.x documents.

Every supported format has its own immutable JSON Schema and registry entry.
Do not edit a published schema in place or infer compatibility from numeric
ordering. A patch may correct diagnostics, documentation or implementation
without changing valid document semantics. A minor adds compatible vocabulary
or optional fields. A major changes existing meanings or removes valid shapes.
If a release changes document acceptance or interpretation, publish its own
schema and explicitly review the migration. No currently unsupported version,
including a patch of the current version, is implicitly accepted.

Before supporting another format, retain all supported source schemas, add the
new schema and a concrete forward edge, and test the complete path from every
supported input to the new current format. Paths must be unique, acyclic and
complete, with source validation, target validation and semantic checks. A
migration changes only the fields required by its reviewed edge; it never guesses
hosts, management authority, credentials or observations. Do not introduce a
schema-only registry entry without its executable migration and fixtures.

# Read Compatibility

Validation selects the exact source schema, applies the explicit upgrade chain,
and validates the current shape and cross-object contracts. Returned `document`
is canonical current data. `dsl_version` identifies the original source format;
`migrations` records the applied edges. These fields describe a read projection,
not an already rewritten history record.

A stored version retains its exact `document_yaml`, digest, creation time, source,
summary and canvas revision number. Bounded `tessiven.read` returns literal
original source with the same DSL/migration metadata, so exact edits match that
source. A cached idempotent result is projected in memory through the same
validation; its persisted request JSON and original fingerprint stay unchanged.
Digest corruption, unknown/future versions and unsupported schemas fail clearly
rather than relabeling or silently downgrading documents.

The frozen legacy v1 read path retains the previously supported repair diagnostics
for unplaced services and service-level layout hints. It does not invent missing
placements or weaken references/security checks. Current semantic-version inputs
receive strict placement validation even when loaded from storage. The
[canvas contract](tessiven-canvas-contract.md) owns those semantic rules.

# New Snapshots And Failure Boundary

Creation, imports, full save and exact edits write the current DSL. The existing
expected-version check, permissions, idempotency and save transaction remain the
single write boundary. A legacy v1 save updates only the root version scalar,
retaining unrelated text, comments, quoting, IDs, bindings and layout hints.
Restore, duplicate and rename also create current snapshots under strict
validation. Existing history is never bulk-rewritten.

Retry identity uses the original submitted arguments, before migration. An exact
retry recovers its original result; submitting normalized arguments under the
same request ID is a conflict. A previously committed historical retry remains
recoverable without rerunning it as a new write. A failed schema validation,
migration, placement repair or version check creates neither a version nor a
request result, and leaves the last canvas intact.

DSL upgrades do not change the `tessiven_canvas_library` SQLite lineage. The
[canvas storage contract](tessiven-canvas-contract.md) continues to own atomic
startup database upgrades independently.

# Schema And Flower Contract

`tessiven.schema` and `GET /schema` default to the current frozen schema. The
optional tool `version` or HTTP `?version=` requests an exact supported DSL
schema; unknown versions are errors. Existing read permissions still apply.
Flower creates current DSL documents and edits exact historical YAML; it relies
on Runtime migration instead of manually relabeling versions. Unsupported
versions require an upgraded compatible Runtime. Historical placement repairs
must be evidence-backed under the
[Flower contract](../ai/tessiven-flower-and-operations.md).

# Evidence

- `spec/tessiven/schema.go` - Exact formats, current identity and forward edges.
- `spec/tessiven/v1.schema.json` - Frozen legacy schema.
- `spec/tessiven/v1.0.0.schema.json` - Current semantic-version schema.
- `internal/tessiven/dsl.go` - Exact selection and byte-preserving legacy upgrade.
- `internal/tessiven/document.go` - Source/target validation and canonical projection.
- `internal/tessiven/store.go` - Immutable history, original retry identity and atomic new snapshots.
- `internal/tessiven/dsl_version_test.go` - Styles, complete paths, unknown versions, edit and restart.
- `internal/tessiven/schema_test.go` - Database migration preserves historical request results.
- `internal/codeapp/appserver/tessiven_test.go` - Version selector and permission boundary.
- `internal/ai/tessiven_tools_test.go` - Model-visible exact schema selection.
