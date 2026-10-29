---
type: Architecture Contract
title: Tessiven DSL versioning
tags: [architecture, tessiven, compatibility]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime owns schema selection and explicit v1→v1.0.0→v1.1.0 migrations. New documents use redeven.io/tessiven/v1.1.0; each edge changes only its version scalar, preserving legacy automatic layout. Reads preserve YAML/digest/revision; authorized edits save current snapshots. Invalid/unknown versions or migration failure leave storage unchanged and require compatible Runtime/repair.

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
