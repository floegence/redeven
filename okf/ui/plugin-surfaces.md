---
type: UI Contract
title: Plugin surfaces
description: Env App exposes official plugins through generated lifecycle clients, SDK-owned sandbox surfaces, Shell-root Activity windows, and explicit permission management.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-23T00:00:00Z
---
# Summary

Plugin UI is a released ReDevPlugin sandbox surface inside Redeven chrome.
Plugin Panel, Plugin Center, and multi-window Activity placement use the
releasable v0.6.7 POST query and durable session-scope contracts. Activity keeps
the user's current page visible and opens each plugin surface in Shell-root
floating chrome. Workbench remains unavailable because the released dependency
lacks a cross-iframe interaction ownership contract. Redeven owns navigation,
window geometry, stacking, and placement;
ReDevPlugin owns iframe bootstrap, first commit, bridge, lifecycle, RPC,
confirmation tokens, streams, and surface revocation.

# Contract

## Discovery and management

The Activity Bar `Plugins` entry opens a product app-grid panel without changing
the current normal surface. The first tile opens Plugin Center. An enabled
official plugin with a valid launch target and its required active grant opens
its surface. A disabled, untrusted, unavailable, not-installed,
permission-required, or policy-restricted item opens management details.

Plugin Center is a dedicated Activity main surface, not Runtime Settings, a
modal, or an overlay. It receives explicit inventory, loading, error,
authorization, refresh, and command props from the Shell. The Shell owns the
single `PluginPlatformClient`, shared scope, and multi-slot registry; view
components do not construct clients or perform hidden lifecycle fetches.

The official catalog currently contains exact Containers identity:
`com.redeven.official` / `com.redeven.official.containers` /
`plugini_redeven_official_containers`. Projection matches all three fields and
uses server-provided management revision. Unrelated installed records are not
adopted. Install/update use the generated signed release ref; no browser package
bytes, trust-state selector, URL install, file install, or local developer
package path exists.

Enable, disable, update, uninstall, and open commands carry
`expected_management_revision`. Permission grant and revoke additionally carry
the exact expected policy revision and revoke epoch. A successful mutation
refreshes inventory.
Mutation outcome unknown tears down affected surfaces, tells the user that
state needs attention, and refreshes rather than retrying. The mutation lane
stays closed until local invalidation settles. Catalog records are consumed
from the generated SDK result without an empty-list fallback.
Management calls receive a per-call `AbortSignal`, and Plugin Center admits one
mutation at a time so rapid clicks cannot submit the same revision twice.

## Permissions and policy

Plugin Center loads installed records, active permission grants, and explicit
security policies as one inventory projection. Official Containers metadata
explains `containers.read`, `containers.execute`, `containers.delete`, and
`containers.images.write`; it does not replace ReDevPlugin enforcement.
`containers.read` is required to open because the initial status/list methods
depend on it. A deny for a different method such as logs affects that operation
without falsely blocking initial launch.

Only an environment administrator may grant or revoke. Non-admin sessions see
the effective state and an administrator-required explanation. A grant toggle
represents the active grant, not effective permission: an allowlist cap or
method deny remains visible as policy management and cannot be overridden by a
grant. A stale granted permission remains revocable even when policy currently
blocks it.

Each mutation uses the current policy revision, management revision, and revoke
epoch. Conflict or failure triggers a fresh inventory/grant/policy read and a
new user confirmation; it is never retried against stale revisions. A committed
mutation invalidates the affected SDK scope before a fresh slot is opened for a
still-valid target. Unknown outcome follows the existing attention and teardown
path.

## Activity surface lifecycle

The Shell creates one authenticated same-origin transport, one
`PluginPlatformClient`, one `PluginSurfaceScope`, and one multi-slot placement
coordinator. Each `ActivityPluginSurfaceWindow` owns one
`PluginSurfaceBody`, whose stage creates a fresh `PluginSurfaceSlot` and calls
`openSurfaceInSlot` with plugin instance, surface id, and exact management
revision. The stage styles the SDK-created direct-child iframe to fill the
available width and height; Redeven never creates the iframe.

The SDK-owned Promise is the only opening boundary. It resolves after the
sandbox load, bridge handshake, worker readiness, and first commit; Redeven does
not implement another bootstrap or first-paint message. The iframe is SDK-owned
and is never reconstructed, moved, adopted, or given a Redeven bridge.

Each slot retires independently:

1. publish `hidden` to the current ready host;
2. abort an in-flight opening;
3. await old slot `close()`;
4. await old slot `dispose()`;
5. remove only that slot from the registry.

Closing or invalidating plugin A cannot retire plugin B. Reopening the same
plugin-instance, surface, and placement activates the existing window; a
different target creates a separate slot. Window activation controls a bounded
Shell z-order band above ordinary preview windows and below modal dialogs.

A terminal SDK error marks the placement failed before retirement. The
coordinator does not publish lifecycle to that disposed host; it serializes
slot close/dispose and reports cleanup failure to the surface UI. If `hidden`
delivery throws, retirement records that failure but still aborts, closes, and
disposes before returning an aggregate error. Retirement work executes once. A
failed close destroys the old iframe but keeps an explicit error shell because
local disposal does not prove server revocation. With v0.6.7, recovery requires
a destructive, second-confirmed authenticated plugin-session teardown that
closes every plugin window and permanently retires the current client/scope.
The error shell cannot silently reopen or discard the target.

Desktop windows are movable and resizable with persisted product-owned
geometry. The same DOM becomes a mobile full-screen modal without remounting
the slot. Only the active mobile window is visible, focusable, or exposed to the
accessibility tree; lower windows receive `hidden`. Titles, iframe accessible
names, opening/closing status, errors, focus trap, and focus restoration use
localized product chrome.

Explicit window close awaits slot close/revoke. Disable, update, and
uninstall first execute the authoritative SDK mutation, whose success or
unknown outcome invalidates the shared scope; Redeven then performs local-only
slot disposal and clears placement state. A failed local quiesce cannot block a
security mutation. Shell disposal cancels pending reads and confirmations and
revokes the shared scope. Read-authorized sessions may dispose the surfaces they
could open. Disconnected-session teardown uses the released durable four-hash
fence and drain, and authenticated session removal waits for exact completion.

Generated browser reads are POST queries. Same-origin requests therefore carry
the exact Origin required by the released guard while preserving CSRF, route
action, and query-effect authorization. Redeven does not add an alternate
endpoint, forge Origin, or relax the guard.

## Confirmation UX

Native blocking confirmation is prohibited. The Shell owns one asynchronous
FIFO queue shared by all plugin surfaces. Each intent is deep-cloned across the
async UI boundary while retaining its live `AbortSignal`. Aborted, retired, or
scope-revoked intents resolve as rejected and the next item advances. Each item
settles once.

The dialog uses product modal chrome and shows the requesting plugin and surface
identity together with the signed plan summary, target, method, and request
hash. Hidden surfaces cannot enqueue or approve a confirmation. Approval and
rejection are explicit. The queue does not infer success, retry a mutation, or
display secret params.

## Workbench requirement

Workbench wrapper markers alone cannot route events that occur inside an opaque
iframe. Unselected-widget canvas wheel, selected-widget local wheel, iframe text
selection, actions, and click activation cannot all be correct without a
source/port-bound SDK interaction callback. ReDevPlugin `v0.6.7` has no such
public callback. Upstream implementation or a local sibling worktree is not a
consumable Redeven dependency.

Redeven therefore rejects Workbench plugin placement. It must not use an
overlay, `pointer-events` switching, focus guessing, synthetic DOM events, or a
second MessageChannel bridge. The upstream contract must expose only
host-neutral activation and normalized host-owned wheel events, bound to the
active frame generation and surface instance. Redeven will remain responsible
for Workbench policy and exported wheel/text/action/activation markers after a
formal upstream release is consumed.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic intent.
Activity, Workbench, widget, navigation, settings, and layout are Redeven
placement concepts and never manifest fields.

Plugin UI state is a projection, not registry authority. The browser does not
verify releases, parse manifests, write registry state, mint CSRF or bridge
tokens, serve plugin assets, or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Owns production discovery, client lifetime, lifecycle commands, and Activity placement.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Implements canonical transport and independent multi-slot coordination.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, responsive visibility, focus, and close recovery.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.tsx:1` - Mounts only an SDK slot and projects lifecycle visibility.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginConfirmationQueue.tsx:1` - Implements abort-aware FIFO confirmation UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated v0.6.7 lifecycle DTOs and signed release refs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Matches exact official identity and projects grants, policies, and revision fences.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Requires Plugin discovery in the built renderer.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.test.ts:1` - Covers canonical fetch and close-before-open ordering.
