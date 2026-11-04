---
type: Runtime Contract
title: Managed Web Services
tags: [architecture, web-services, runtime, containers, security]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven owns instances/resources/bindings/operations/forwards; verified templates define behavior. One engine serves Host/Container/Compose lifecycle. Registry and exact resource identity authorize actions; invalid provenance, ownership, permission or health never adopts unknown resources.

# Contract

- Load published redeven-service-templates before Registry/Manager. Recommendations default new installs; explicit compatible releases override and later catalogs never change installed identity. Failed creation removes only verified new containers, preserving data/workspace for review.
- RuntimeBinding v2/SHA-256 binds Host paths, Container name or Compose project/root. [Opening](managed-web-service-opening.md) separates entrance failure from health.
- ServiceView actions/status/primary action own presentation; old errors cannot disable healthy instances. [Recovery](service-management-recovery.md) owns explicit actions.
- portforward_registry_v2 schema 6 preserves v1 lineage: template/configuration/release/binding/digest, workspace/resources, desired/observed state, protected Forward/artifact/failures; no template snapshots/revisions/duplicate deployment. Schema 2 added ordinary-forward paths; managed open-session follows [session policy](web-service-browser-sessions.md).

## Host release application
Update installs/verifies, resolves final installed metadata into one digest, replaces the process and health-checks before commit. Launch/journal/registry share the final digest; enriched trust creates no false pending changes. Originally stopped services return to stopped after verification. Failure retains rollback/recovery.

## Image pull feedback
Container pulls publish the executed command and ordered output through the existing operation reporter, including success, failure and cancellation. The reporter owns redaction and the 400-line/128-KiB output bound. Transfer rate derives from observed downloaded bytes over a short time window, retains the previous sample across sparse updates and decays when subsequent observations show no download. Layer completion is independent of byte progress.

# Boundaries

No built-in service identities, copy, assets, commands or application-specific adoption logic live here. Never auto-upgrade releases, infer ownership from engine state, move application data or exceed typed template credential policy.

# Evidence

- `redeven:internal/managedwebservice/host_update_identity_test.go` - Reproduces stale digest; verifies running/stopped intent.
- `redeven:internal/managedwebservice/host_update_native_test.go` - Real process replacement, health, persisted identity, ready Open and cleanup. Install boundary is deterministic; no live npm qualification.
- `redeven:internal/managedwebservice/image_pull_docker_integration_test.go` - Opt-in `REDEVEN_IMAGE_PULL_DOCKER_TEST=1` starts a task-owned Docker-in-Docker daemon and throttled local registry with two unique layers. Verifies measured bytes/rate, persisted command/output, pinned cache and missing-image errors; removes only its daemon and volumes. Requires cached `docker:29-dind` and Desktop host networking. `REDEVEN_IMAGE_PULL_EVIDENCE` optionally exports the running operation for UI qualification.
