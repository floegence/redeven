---
type: Architecture Contract
title: Managed Service Instance Configuration
tags: [architecture, web-services, containers, configuration, security]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

The verified current template owns Runtime baseline; Redeven owns overrides, exact release, digest, Resource Plans, secrets, journals and rebuilds. Renderer owns an unsaved draft. One resolver combines baseline and differences. Runtime apply requires stopped state, current revision, exact plan and risk checks; invalid input fails before commit and failed rebuild restores prior state or reports rollback failure.

# Contract

- Canonical versioned configuration stores differences, accepted notices, stable resource IDs and secret-variable names; revision/SHA-256 commit together. Metadata commits independently of Runtime apply.
- Running services may edit drafts but require explicit Stop; no background stop/rebuild. Images/digests, primary Web port, loopback binding, Runtime/Compose identity, reserved labels and managed volume identities cannot be overridden. Renderer never submits raw Docker argv.
- Secret values live only in service-private `0600` files, never configuration, plans, views, audits, events, logs or renderer persistence. Cancellation ends the owned operation before rollback.
- Current Registry schema retains configuration v2, release identity, RuntimeBinding v2, applied digest, progress/retry, ownership/deletion and release-check v2 facts. Verify persisted digests before typed validation; [Registry migration](database-schema-migrations.md) owns current version and lineage.

# Boundaries

No change to template topology/endpoint, ReDevPlugin or public IPC; no raw engine commands, silent stops or unreviewed host authority.

# Evidence

- `redeven:internal/managedwebservice/configuration.go` - Defines the override document, canonical identity, typed validation, and managed anchors.

- `redeven:internal/managedwebservice/settings.go` - Owns settings projection, secret redaction, candidate construction, Resource Plans, and risk classification.
