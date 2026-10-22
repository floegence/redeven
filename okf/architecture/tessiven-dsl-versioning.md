---
type: Architecture Contract
title: Tessiven DSL versioning
description: Select exact frozen DSL schemas and migrate supported documents without rewriting history.
tags: [architecture, tessiven, compatibility]
timestamp: 2026-10-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Runtime owns Tessiven DSL schema selection and explicit forward migrations.
New documents use `apiVersion: redeven.io/tessiven/v1.1.0`. Supported legacy
`redeven.io/tessiven/v1` and `v1.0.0` remain readable through the reviewed
`v1 -> v1.0.0 -> v1.1.0` chain. Each edge updates only the version scalar;
new group packing rules are opt-in and older documents retain automatic layout. Reads project current structured data while preserving historical YAML,
digest and revision identity. Authorized edits save a new current snapshot.
Unknown versions, invalid source/target documents or migration failures leave
stored data intact; users need a compatible Runtime or a valid repair.

# Contract

## Version Identities And Releases
DSL identities use stable `vMAJOR.MINOR.PATCH` strings, for example `v1.2.3`.

Paths must be unique, acyclic and complete, with source validation, target validation and semantic checks. Do not introduce a schema-only registry entry without its executable migration and fixtures.

## Read Compatibility
Validation selects the exact source schema, applies the explicit upgrade chain, and validates the current shape and cross-object contracts. Returned `document` is canonical current data.

The [canvas contract](tessiven-canvas-contract.md) owns those semantic rules.

Native rendering uses the independently frozen [canvas presentation contract](tessiven-canvas-presentation.md), not the current DSL identity. Every DSL release must verify its explicit mapping to the oldest supported display contract without rewriting source or granting resource authority.

Ordinary edits valid in the original schema continue to upgrade automatically; no historical YAML is rewritten.

# Boundaries

## New Snapshots And Failure Boundary
Creation, imports, full save and exact edits write the current DSL. Existing history is never bulk-rewritten.

The [canvas storage contract](tessiven-canvas-contract.md) continues to own atomic startup database upgrades independently.

# Evidence

- `spec/tessiven/schema.go` - Exact formats, current identity and forward edges.

- `spec/tessiven/v1.schema.json` - Frozen legacy schema.

- `spec/tessiven/v1.0.0.schema.json` - Frozen semantic baseline schema.
