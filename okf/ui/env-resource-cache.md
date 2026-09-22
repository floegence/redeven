---
type: UI Contract
title: Env App resource snapshots
description: Restore authorized local presentation snapshots while refreshing Host Applications, Containers, and Web Services.
tags: [ui, desktop, caching, security]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

The published Floe resource cache owns disposable snapshot restoration, request
coalescing, response fencing, persistence, and capacity eviction. Redeven owns
identity confirmation and explicit presentation projections. Host Applications,
Containers, and Web Services show their most recent successful inventory while
fetching current facts. Refresh changes only the existing refresh icon during
normal operation. Cached facts never authorize an operation. A permission denial
or locked access clears the affected presentation; ordinary connectivity failure
retains it with the existing error and retry affordance.

# Identity and authority

The Shell requests `GET /_redeven_proxy/api/ui-cache-scope` after read permission
and the authenticated connection are established. The server hashes its session's
endpoint, namespace, and user identity into an opaque `scope_id`. The value is
not a credential and cannot select request authority. Pages reuse that confirmed
scope; they never request it independently. Before confirmation, live requests
remain possible but durable snapshots cannot be restored.

Browser origin storage and Desktop's native environment/account owner partition
isolate access sources. Resource keys further separate host catalog locale and
each container engine, endpoint, and resource view. Activity and Workbench share
resource facts within a confirmed scope; each instance retains its own navigation,
selection, filter, and search state. Scope changes fence asynchronous results.
Read denial and access locking invalidate the old scope, including its persisted
records. A transient transport failure does not delete successful snapshots.
On a new authenticated session, presentation waits for identity confirmation
again; data fetched under a prior unconfirmed session cannot reappear.

# Persistence and presentation

Browser clients use Floe's asynchronous IndexedDB adapter. Desktop exposes an
asynchronous, root-session-only IPC adapter backed by private, atomically replaced
files in `userData/resource-cache`. Cache files never enter synchronous UI
preferences. Floe's eviction policy applies a 32 MiB budget; Desktop additionally
applies the same policy across its complete private cache directory so opening
another environment does not multiply that budget. Eviction affects only
re-fetchable snapshots, never user configuration. Snapshots have a version and
validated projection, no time expiry, and least-recently-used eviction. Malformed,
incompatible, unavailable, or quota-limited storage does not block live content.

Desktop preserves the published cache module's native ESM import inside its
CommonJS main-process output. Type checking covers both the production compiler
configuration and the renderer configuration. Restart acceptance executes the
production compiler's emitted cache adapter, without bundling away its package
loading boundary.

Disk restoration and network refresh run concurrently. A late disk read cannot
replace a new response. Identical successful projections do not rewrite payloads;
changed projections coalesce before asynchronous persistence. Failures never
become successful snapshots. Empty successful inventories are valid cached data.

The allowlisted projection retains application metadata, PNG icons, and running
or session summaries; container runtime/service summaries and target inventories;
and saved and managed Web Service presentation fields, including managed icons.
It excludes viewer forwards, credentials, query secrets, temporary access URLs,
active operations, execution plans, configuration contents, logs, terminal data,
live metrics, and raw inspect documents. Detail requests stay live and on demand.

Stable resource identities key rendered rows. Refresh preserves surviving row
nodes, focus, list controls, scroll, and current selections; it does not replay
entry animations. Container targets update independently and a failed target
retains its previous inventory. Fresh authoritative absence clears that target's
selection. Web Service list requests do not wait for template discovery.

# Actions and recovery

A stale application is resolved through current inventory before launch. Quit
checks the current process-instance set; a replacement requires another explicit
confirmation. Session actions retain server authorization and current target
checks. Container mutations continue through the existing exact-target server
preflight. Web Services retain their current management-plan and open-session
boundaries; a cached saved forward is resolved before opening its route or
reviewing an edit or deletion. Editing uses the current full saved configuration,
never the projection that omits query credentials.

Successful mutations invalidate affected durable snapshots before refreshing,
preventing an older in-flight read from restoring a deleted item. Pending work
is scoped to the operation target. Cached restoration never installs components,
requests permissions, launches processes, or starts lifecycle operations.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/envResourceCache.ts` - Published cache binding and Shell identity confirmation.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceSnapshots.ts` - Explicit snapshot projections.
- `redeven:internal/codeapp/appserver/ui_cache_scope_test.go` - Authenticated scope isolation and read permission.
- `redeven:desktop/src/main/desktopResourceCache.ts` - Asynchronous private files and global budget adapter.
- `redeven:desktop/scripts/check-resource-cache.mjs` - Production compiler output and preload persistence across two Electron processes.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceCache.test.ts` - Scope races, authorization clearing, and empty-list retention.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceSnapshots.test.ts` - Sensitive field exclusion and corrupt input rejection.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.browser.test.tsx` - IndexedDB directory/icon restore and focus continuity.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Activity/Workbench inventory continuity.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Saved service recovery independent of template discovery.
