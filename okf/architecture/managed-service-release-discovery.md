---
type: Runtime Contract
title: Managed service release discovery and version selection
tags: [architecture, web-services, releases, npm, oci, updates]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Registries provide release candidates; Manager validates immutable identity, compatibility and reviewed update plans. Discovery and selection execute nothing. One drawer retains browsing, selection and failures, while admitted work outlives it and rollback preserves verified prior release/binding.

# Contract

## Release discovery
- Schema-v2 `ReleaseCandidate` carries source/version/time/channel, trust, compatibility, immutable identity, verification/selectability and installed relation. Verification cannot reorder visible rows. Cancellation changes no state; failed checks retain stale last success without blocking actions or toasts.
- Host npm declares exact default, HTTPS registry, executable, optional Secret token and non-secret environment. Tokens exist only in requests/task-owned `0600` npm files, never persistent state, argv, logs, hooks or plaintext cache keys. Compatibility/stopped-state checks remain backend-owned.
- Single-container OCI discovers its repository; Compose has no single release identity. Consume cursors only after successful pages. After a failed recommendation check, disable install until verified selection or closing the template flow.
- `managed_service_update_v2` is the sole old/target/phase journal; failure restores verified prior release/binding. [Version interaction](#version-interaction) owns selection, notices, stop guidance and handoff.

## Version interaction
- Installed version opens the drawer; never auto-select the first result. Keep service/current-version header, restored candidates during refresh and one scrolling viewport. Notices stay below the list without shifting prior rows; footer links to outstanding confirmation.
- Downgrades/unknown ordering follow Manager stopped-state requirements. [Operation progress](managed-service-operation-progress.md) owns completion/failure/cleanup without drawer polling or another lifecycle.
- Browser qualification visually reviews light/dark wide/narrow screenshots with notices, stop guidance, preparation/rejection and long translations; screenshots supplement assertions.

# Boundaries

Redeven does not mirror source content/credentials or guarantee registry availability. Private access uses credentials supplied for that exact source.

Only explicit submit requests execution. Selection, preparation and closing a drawer cannot create or cancel a backend lifecycle implicitly.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Source.
- `redeven:internal/managedwebservice/release_catalog.go` - Source.
- `redeven:internal/managedwebservice/update_plan.go` - Source.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/pages/managedServiceUpdatePreparation.test.ts` - Tests.
