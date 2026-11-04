---
type: Desktop Contract
title: Host application component cache
tags: [desktop, applications, cache, installation]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published artifactcache owns verification, locking and eviction. Desktop supplies its private directory, seven-day idle retention and 2 GB budget plus document-local transfers/UI. Devices reuse verified archives; cancellation retains completed cache. Unknown catalogs fail and cleanup cannot negate successful preparation.

# Contract

## Acquisition and retention
Desktop delegates to its bundled Runtime's `host-application-package` command. Different architectures can reuse identical common files; all others must match their pinned catalog entry.

Other component consumers do not inherit this product's eviction policy.

## Temporary transfer ownership
The initiating Desktop document owns its subprocess and temporary ZIP.

The [preparation contract](../architecture/host-applications.md#preparation) owns those boundaries and pending application opening.

## Honest progress and recovery
The delivery choice explains that Desktop reuses its cache and downloads only missing components.

After explicit preparation, waiting and checking have unknown cache/download totals and no percentage.

Closing a reserved app window still retires its launch intention.

# Boundaries

This policy applies only to Desktop graphical component archives. Temporary ZIPs are transfer resources and are not included in the persistent archive capacity.

# Evidence

- [Runtime adapter](../../cmd/redeven/host_application_package.go): fixed retention policy, released SDK calls and independent maintenance diagnostics.
- [Desktop regression tests](../../desktop/src/main/hostApplicationComponents.test.ts): cancellation, cache preservation and temporary-file boundaries.
