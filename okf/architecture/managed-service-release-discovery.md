---
type: Runtime Contract
title: Managed Service release discovery and updates
description: Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
quality_exception: Cross-domain release lifecycle contract spanning discovery, verification, installation, rollback, and UI selection states.
tags: [architecture, web-services, releases, npm, oci, updates]
timestamp: 2026-09-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the configured npm or OCI Registry owns source metadata; Redeven owns candidate validation, exact installed identity, updates, and rollback.
- Outcome: users inspect source releases, select one compatible identity, and deploy, upgrade, or downgrade without a Redeven version service.
- Invariants: recommendations are defaults only; discovery never installs; unavailable recommendations stay historical and cannot become implicit installs; Renderer submits opaque expiring IDs; operations revalidate their source; installed services retain hashed release identity.
- Failure boundary: discovery, authentication, compatibility, or update failure changes only its check or operation; the last healthy service and persisted last-success summary remain usable.

# Contract

## Candidate discovery
Schema-v2 `ReleaseCandidate` projects npm and OCI source, version or tag, publication time, channel, trust, compatibility, immutable identity, verification state, selectability, markers, and installed-release relation. Publication metadata never reorders a visible row when asynchronous verification completes.

Cancellation changes neither memory nor persistence; source failure preserves a last success as stale without blocking service actions or creating a toast.

## npm Host source and installation
TemplateSpec v6 Host declares an exact npm default, HTTPS Registry, executable, optional Secret-backed token, and non-secret environment. Tokens exist only in the request and a task-owned mode-0600 npm file, never persistent state, commands, logs, Hooks, or plaintext cache keys.

They do not add checkbox gates; technical compatibility and stopped-state requirements remain authoritative backend checks.

## OCI source and selection
Single-container templates discover directly from their image repository; Compose is excluded because multiple image versions do not form one release identity. A cursor is consumed only after its page succeeds, so cancellation and temporary failure remain retryable.

A template install cannot close the version picker and silently continue with an invalid default: once a failed recommendation check is observed, the install action stays disabled until the user selects a verified candidate or closes the template flow.

## Update, downgrade, and recovery
`managed_service_update_v2` is the only update journal and records old and target state plus phase. Failure restores the verified prior release and binding.

The [version interaction contract](managed-service-version-interaction.md) owns the single-drawer selection, notice confirmation, stopped-state guidance, request feedback, and operation handoff.

# Boundaries

Redeven does not mirror packages, images, metadata, or credentials and does not promise Registry availability. Private Registry support is limited to credentials already provided for that exact source.

# Evidence

- `redeven:internal/managedwebservice/release_discovery.go` - Persists, scopes, revalidates, restores, and schedules release candidates and summaries.

- `redeven:internal/managedwebservice/release_catalog.go` - Owns the open, refresh, continue, verify, cursor, candidate, and partial-failure state machine.

- `redeven:internal/managedwebservice/update_plan.go` - Creates, validates, expires, and consumes the single release-and-template update plan.
