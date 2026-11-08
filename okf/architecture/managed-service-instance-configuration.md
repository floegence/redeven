---
type: Architecture Contract
title: Managed Service Instance Configuration
tags: [architecture, web-services, containers, configuration, security]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Verified template owns baseline; Redeven owns overrides, release/digest, resources, secrets and rebuilds. One resolver combines baseline/differences. Apply requires stopped state, current revision/plan/risk checks; failure preserves prior state or explicitly reports rollback failure.

# Contract

- Canonical versioned configuration stores differences, accepted notices, stable resource IDs and secret-variable names; revision/SHA-256 commit together. Metadata commits independently of Runtime apply.
- Running services may edit drafts but require explicit Stop; no background stop/rebuild. Images/digests, primary Web port, loopback binding, Runtime/Compose identity, reserved labels and managed volume identities cannot be overridden. Renderer never submits raw Docker argv.
- Secret values live only in service-private `0600` files, never configuration, plans, views, audits, events, logs or renderer persistence. Cancellation ends the owned operation before rollback.
- Current Registry schema retains configuration v2, release identity, RuntimeBinding v2, applied digest, progress/retry, ownership/deletion and release-check v2 facts. Verify persisted digests before typed validation; [Registry migration](database-schema-migrations.md) owns current version and lineage.

Explicit Git source upgrades use the [source-version contract](managed-web-service-templates.md#instance-source-versions). The reviewed target preserves existing overrides and release identity. The plan includes its source digest; configuration and source binding commit atomically. Collection overrides encode explicit empty arrays/maps rather than pointer-to-null values so clear operations remain canonical after reload.

# Boundaries

Settings retains one editor per visited service. Semantic opening identity excludes list-refresh churn. Navigation fences stale reads/plans but always settles pending preflight/apply busy state. Confirmed runtime apply adopts the new revision on reopening while preserving independent unsaved metadata; failed apply keeps its draft. Template dialogs opened from settings follow the host presentation.

No change to template topology/endpoint, ReDevPlugin or public IPC; no raw engine commands, silent stops or unreviewed host authority.

# Evidence

- `redeven:internal/managedwebservice/configuration.go` - Source.
