---
type: Runtime Contract
title: Managed Service release discovery and updates
description: Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
quality_exception: Cross-domain release lifecycle contract spanning discovery, verification, installation, rollback, and UI selection states.
tags: [architecture, web-services, releases, npm, oci, updates]
timestamp: 2026-09-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Configured npm/OCI registries own release metadata; Redeven validates candidates, installed identity, updates and rollback. Users explicitly select compatible releases without a Redeven version service. Discovery never installs; recommendations are defaults only. Expiring opaque IDs are revalidated at execution. Failure preserves healthy service and last-success summaries without implicit installation.

# Contract

- Schema-v2 `ReleaseCandidate` carries source/version/time/channel, trust, compatibility, immutable identity, verification/selectability and installed relation. Verification cannot reorder visible rows. Cancellation changes no state; failed checks retain stale last success without blocking actions or toasts.
- Host npm declares exact default, HTTPS registry, executable, optional Secret token and non-secret environment. Tokens exist only in requests/task-owned `0600` npm files, never persistent state, argv, logs, hooks or plaintext cache keys. Compatibility/stopped-state checks remain backend-owned.
- Single-container OCI discovers its repository; Compose has no single release identity. Consume cursors only after successful pages. After a failed recommendation check, disable install until verified selection or closing the template flow.
- `managed_service_update_v2` is the sole old/target/phase journal; failure restores verified prior release/binding. [Version interaction](managed-service-version-interaction.md) owns selection, notices, stop guidance and handoff.

# Boundaries

Redeven does not mirror source content/credentials or guarantee registry availability. Private access uses credentials supplied for that exact source.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Persists, scopes, revalidates, restores, and schedules release candidates and summaries.

- `redeven:internal/managedwebservice/release_catalog.go` - Owns the open, refresh, continue, verify, cursor, candidate, and partial-failure state machine.

- `redeven:internal/managedwebservice/update_plan.go` - Creates, validates, expires, and consumes the single release-and-template update plan.
