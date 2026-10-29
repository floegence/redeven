---
type: UI Contract
title: Env App resource snapshots
tags: [ui, desktop, caching, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns disposable restoration, coalescing, fencing, persistence and eviction; Redeven confirms identity/projection. Host Apps, Containers, Web Services and Codespaces retain last successful inventory during refresh, animating only its icon. Cache grants no authority. Denial/locked access clears affected display; connectivity failure retains facts with error/Retry.

# Contract

## Identity and authority
The Shell requests `GET /_redeven_proxy/api/ui-cache-scope` as soon as an authenticated connection is available, in parallel with current-session read permission confirmation. The value is not a credential and cannot select request authority.

Container projections follow that same owner instead of clearing their inventory on connection changes.

## Persistence and presentation
Browser clients use Floe's asynchronous IndexedDB adapter. Cache files never enter synchronous UI preferences.

Activating a Codespaces view refreshes its shared inventory; no new polling or connection recovery loop is introduced.

## Actions and recovery
A stale application is resolved through current inventory before launch.

Cached restoration never installs components, requests permissions, launches processes, or starts lifecycle operations.

# Boundaries

Cached snapshots never authorize mutations. The cache does not own product identity confirmation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/envResourceCache.ts` - Published cache binding and Shell identity confirmation.

- `redeven:internal/codeapp/appserver/ui_cache_scope_test.go` - Authenticated scope isolation and read permission.
