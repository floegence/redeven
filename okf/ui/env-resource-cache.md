---
type: UI Contract
title: Env App resource snapshots
description: Restore authorized local presentation snapshots while refreshing Host Applications, Containers, Web Services, and Codespaces.
tags: [ui, desktop, caching, security]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The published Floe resource cache owns disposable snapshot restoration, request
coalescing, response fencing, persistence, and capacity eviction. Redeven owns
identity confirmation and explicit presentation projections. Host Applications,
Containers, Web Services, and Codespaces show their most recent successful inventory while
fetching current facts. Refresh changes only the existing refresh icon during
normal operation. Cached facts never authorize an operation. A permission denial
or locked access clears the affected presentation; ordinary connectivity failure
retains it with the existing error and retry affordance.

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

- `redeven:internal/envapp/ui_src/src/ui/services/envResourceSnapshots.ts` - Explicit snapshot projections.

- `redeven:internal/codeapp/appserver/ui_cache_scope_test.go` - Authenticated scope isolation and read permission.
