---
type: Architecture Contract
title: Tessiven canvas contract
description: Store immutable service canvases in one Runtime-owned library.
tags: [architecture, tessiven, persistence]
timestamp: 2026-10-05T00:00:00Z
---
# Summary

Tessiven is the Runtime-owned library of immutable service canvases. Each
canvas stores a complete `redeven.io/tessiven/v1` YAML document and every save
creates a new version. The Runtime is the single owner of canvas data; the
Desktop Welcome surface and the local Env App render that same library. A
failed validation or version conflict leaves the last saved document intact.

# Contract

- A canvas document contains stable IDs for Runtime nodes, visual groups,
  business services, instances, external resources, relations, and evidence.
- Groups are visual membership only. Instance bindings and Runtime references
  are data references and do not grant permission or create a connection.
- Relations require evidence and may form cycles. Missing observations remain
  explicitly unknown.
- The schema accepts data and presentation hints only. It does not accept
  executable scripts, credentials, arbitrary styles, or management commands.
- Saves use an expected latest version and an idempotent request ID. A restore,
  rename, or duplicate produces a new complete version or canvas identity.
- Historical and archived versions are readable but cannot mutate resources.

# Evidence

- `spec/tessiven/v1.schema.json`
- `internal/tessiven/document.go`
- `internal/tessiven/store.go`
- `internal/tessiven/store_test.go`
