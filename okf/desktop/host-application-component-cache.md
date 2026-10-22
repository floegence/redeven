---
type: Desktop Contract
title: Host application component cache
description: Reuse verified graphical component archives across devices and present actual download and transfer progress.
tags: [desktop, applications, cache, installation]
timestamp: 2026-09-24T16:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The released `floe-native-apps/artifactcache` SDK owns archive verification,
exclusive cache access and eviction. Redeven Desktop owns its private directory,
seven-day idle retention and 2,000,000,000-byte archive budget, document-scoped
transfer files and localized presentation. Multiple devices reuse the same
verified publisher files; upload remains independent for each host. Cancellation
preserves completed archives. Unknown catalogs fail explicitly, and cleanup
failures never replace successful preparation with an installation failure.

# Contract

## Acquisition and retention
Desktop delegates to its bundled Runtime's `host-application-package` command. Different architectures can reuse identical common files; all others must match their pinned catalog entry.

Other component consumers do not inherit this product's eviction policy.

## Temporary transfer ownership
The initiating Desktop document owns its subprocess and temporary ZIP.

The [preparation contract](../architecture/host-application-preparation.md) owns those boundaries and pending application opening.

## Honest progress and recovery
The delivery choice explains that Desktop reuses its cache and downloads only missing components.

After explicit preparation, waiting and checking have unknown cache/download totals and no percentage.

Closing a reserved app window still retires its launch intention.

# Boundaries

This policy applies only to Desktop graphical component archives. Temporary ZIPs are transfer resources and are not included in the persistent archive capacity.

# Evidence

- [Runtime adapter](../../cmd/redeven/host_application_package.go): fixed retention policy, released SDK calls and independent maintenance diagnostics.

- [Desktop ownership](../../desktop/src/main/hostApplicationComponents.ts): startup cleanup, scoped subprocesses and bounded chunk reads.

- [Desktop regression tests](../../desktop/src/main/hostApplicationComponents.test.ts): cancellation, cache preservation and temporary-file boundaries.
