---
type: UI Contract
title: Env App resource snapshots
description: Restore authorized local presentation snapshots while refreshing Host Applications, Containers, Web Services, and Codespaces.
tags: [ui, desktop, caching, security]
timestamp: 2026-09-22T00:00:00Z
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

# Identity and authority

The Shell requests `GET /_redeven_proxy/api/ui-cache-scope` as soon as an
authenticated connection is available, in parallel with current-session read
permission confirmation. The server hashes its session's
endpoint, namespace, and user identity into an opaque `scope_id`. The value is
not a credential and cannot select request authority. Pages reuse that confirmed
scope; they never request it independently. While either confirmation is pending, inventory pages retain their target
skeleton and publish neither durable nor temporary live inventory. An ordinary
scope lookup failure permits live inventory through an isolated volatile owner;
it never enables durable reads or writes. A permission denial remains closed.

Browser origin storage and Desktop's native environment/account owner partition
isolate access sources. Resource keys further separate host catalog locale and
each container engine, endpoint, and resource view. Activity and Workbench share
resource facts within a confirmed scope; each instance retains its own navigation,
selection, filter, and search state. Scope changes fence asynchronous results.
Read denial and access locking invalidate the old scope, including its persisted
records. A transient transport failure does not delete successful snapshots.
On a new authenticated session, presentation waits for identity confirmation
again. Permission results carry their authenticated connection identity, and old
cache handles and pending requests are retired before a new owner is exposed.
Data fetched under a prior unconfirmed session cannot reappear.

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

After confirmation, disk restoration and network refresh run concurrently. Floe
`ResourceSnapshot.restoring` owns the disk read lifecycle, including misses,
corruption, and storage failure; a successful network response ends restoration
immediately. A late disk read cannot
replace a new response. Identical successful projections do not rewrite payloads;
changed projections coalesce before asynchronous persistence. Failures never
become successful snapshots. Empty successful inventories are valid cached data.

The allowlisted projection retains application metadata, PNG icons, and running
or session summaries; container runtime/service summaries and target inventories;
saved and managed Web Service presentation fields, including managed icons; and
Codespace identity, name, description, workspace path, port, timestamps, and
running/PID summaries. Browser Editor readiness and setup progress remain live.
It excludes viewer forwards, credentials, query secrets, temporary access URLs,
active operations, execution plans, configuration contents, logs, terminal data,
live metrics, and raw inspect documents. Detail requests stay live and on demand.

Stable resource identities key rendered rows. Refresh preserves surviving row
nodes, focus, list controls, scroll, and current selections; it does not replay
entry animations. Container targets update independently and a failed target
retains its previous inventory. Fresh authoritative absence clears that target's
selection. A runtime or inventory request that fails before disk restoration
finishes still waits for the available snapshot before publishing its error;
authorization rejection clears presentation immediately. Web Service list
requests do not wait for template discovery.

## Startup and loading continuity

The selected Activity module is preloaded. During initial access checking the
Shell presents the target page's skeleton immediately, without extending the
boot cover. Password and two-factor challenges retain the explicit access gate.
The module fallback and first inventory placeholder share the real page's
header, controls, list regions, and row geometry. Host Applications reserves its
running and catalog sections; Containers uses its selected resource view;
Web Services retains its address form, search toolbar, and list rows; Codespaces
uses the common card frame. Unknown counts are omitted. Resource additions and
removals can legitimately change list length.

Successful content, including empty inventories, is not replaced with a loading
placeholder during refresh. Web Services combines its saved and managed list
readiness before declaring an empty collection, while showing available nonempty
content immediately. Its search toolbar stays mounted and a stable scrollbar
gutter prevents width changes when inventory length crosses the viewport.
Skeleton rows do not replay entry animations or introduce a cache notice.

Activity navigation has one separate owner defined by
[Activity navigation restoration](activity-navigation-restoration.md).

Browser Editor readiness is fetched independently without suspending the page.
Normal inventory and readiness refreshes share the header refresh spinner. A
missing editor or setup failure still uses the existing explicit setup activity.
Activating a Codespaces view refreshes its shared inventory; no new polling or
connection recovery loop is introduced.

# Actions and recovery

A stale application is resolved through current inventory before launch. Quit
checks the current process-instance set; a replacement requires another explicit
confirmation. Session actions retain server authorization and current target
checks. Container mutations continue through the existing exact-target server
preflight. Web Services retain their current management-plan and open-session
boundaries; a cached saved forward is resolved before opening its route or
reviewing an edit or deletion. Editing uses the current full saved configuration,
never the projection that omits query credentials. Codespaces revalidates a stale
or refreshing inventory before opening, starting, stopping, or reviewing deletion;
a disappeared target cannot continue into the previous action. When the editor
is ready, a browser popup is reserved during the click gesture before that
validation waits on the network; failed validation closes it without navigation. Editor preparation,
entry ticket, native authentication, and server lifecycle checks stay authoritative.
Successful deletion removes the target from the shared snapshot before refresh,
so a subsequent network failure or remount cannot resurrect it.

Successful mutations invalidate affected durable snapshots before refreshing,
preventing an older in-flight read from restoring a deleted item. Pending work
is scoped to the operation target. Cached restoration never installs components,
requests permissions, launches processes, or starts lifecycle operations.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/envResourceCache.ts` - Published cache binding and Shell identity confirmation.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceSnapshots.ts` - Explicit snapshot projections.
- `redeven:internal/codeapp/appserver/ui_cache_scope_test.go` - Authenticated scope isolation and read permission.
- `redeven:desktop/src/main/desktopResourceCache.ts` - Asynchronous private files and global budget adapter.
- `redeven:internal/envapp/ui_src/scripts/checkStartupContinuity.mjs` - Real compiled Shell, delayed permission/scope/network, persistent IndexedDB, and frame-by-frame continuity.
- `redeven:desktop/scripts/check-startup-continuity.mjs` - Actual Electron restart with production native adapters and changed loopback ports.
- `redeven:desktop/scripts/check-resource-cache.mjs` - Production compiler output and preload persistence across two Electron processes.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceCache.test.ts` - Scope races, authorization clearing, and empty-list retention.
- `redeven:internal/envapp/ui_src/src/ui/services/envResourceSnapshots.test.ts` - Sensitive field exclusion and corrupt input rejection.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.browser.test.tsx` - IndexedDB directory/icon restore and focus continuity.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvContainersPage.browser.test.tsx` - Activity/Workbench inventory continuity.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.browser.test.tsx` - Saved service recovery independent of template discovery.

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.test.tsx` - Remount, empty inventory, refresh failures, authorization rejection, deletion validation, and editor setup regression coverage.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.browser.test.tsx` - IndexedDB restoration, stable nodes/focus/scroll, and exact skeleton geometry across viewport sizes and locales.
