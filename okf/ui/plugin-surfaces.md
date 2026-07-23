---
type: UI Contract
title: Plugin surfaces
description: Env App exposes official plugins through generated lifecycle clients and SDK-owned sandbox surfaces with serialized placement and confirmation.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-07-19T00:00:00Z
---
# Summary

Plugin UI is a released ReDevPlugin sandbox surface inside Redeven chrome.
Plugin Panel, Plugin Center, and Activity placement use the releasable v0.6.7
POST query and durable session-scope contracts. Workbench remains unavailable
because it lacks a cross-iframe interaction ownership contract. Redeven owns
navigation and placement;
ReDevPlugin owns iframe bootstrap, first commit, bridge, lifecycle, RPC,
confirmation tokens, streams, and surface revocation.

# Contract

## Discovery and management

The Activity Bar `Plugins` entry opens a product app-grid panel without changing
the current normal surface. The first tile opens Plugin Center. An enabled
official plugin with a valid launch target opens its surface; a disabled,
untrusted, unavailable, or not-installed item opens management details.

Plugin Center is a dedicated Activity main surface, not Runtime Settings, a
modal, or an overlay. It receives explicit inventory, loading, error,
authorization, refresh, and command props from the Shell. The Shell owns the
single `PluginPlatformClient`; view components do not construct clients or
perform hidden lifecycle fetches.

The official catalog currently contains exact Containers identity:
`com.redeven.official` / `com.redeven.official.containers` /
`plugini_redeven_official_containers`. Projection matches all three fields and
uses server-provided management revision. Unrelated installed records are not
adopted. Install/update use the generated signed release ref; no browser package
bytes, trust-state selector, URL install, file install, or local developer
package path exists.

Enable, disable, update, uninstall, and open commands carry
`expected_management_revision`. A successful mutation refreshes inventory.
Mutation outcome unknown tears down affected surfaces, tells the user that
state needs attention, and refreshes rather than retrying. The mutation lane
stays closed until local invalidation settles. Catalog records are consumed
from the generated SDK result without an empty-list fallback.
Management calls receive a per-call `AbortSignal`, and Plugin Center admits one
mutation at a time so rapid clicks cannot submit the same revision twice.

## Activity surface lifecycle

The Shell creates one authenticated same-origin transport, one
`PluginPlatformClient`, one `PluginSurfaceScope`, and one serial placement
coordinator. A `PluginSurfaceFrame` creates a fresh `PluginSurfaceSlot` for its
stage and calls `openSurfaceInSlot` with plugin instance, surface id, and exact
management revision.

The SDK-owned Promise is the only opening boundary. It resolves after the
sandbox load, bridge handshake, worker readiness, and first commit; Redeven does
not implement another bootstrap or first-paint message. The iframe is SDK-owned
and is never reconstructed, moved, adopted, or given a Redeven bridge.

Every replacement is serialized:

1. publish `hidden` to the current ready host;
2. abort an in-flight opening;
3. await old slot `close()`;
4. await old slot `dispose()`;
5. remove the old placement;
6. create a new stage and slot;
7. await `openSurfaceInSlot()` and first commit;
8. publish the actual `visible` or `hidden` state.

A terminal SDK error marks the placement failed before retirement. The
coordinator does not publish lifecycle to that disposed host; it serializes
slot close/dispose and reports cleanup failure to the surface UI. If `hidden`
delivery throws, retirement records that failure but still aborts, closes, and
disposes before returning an aggregate error. Retirement work executes once;
every later release observes the same terminal success or failure instead of
turning an earlier revoke failure into success.

Explicit navigation close awaits slot close/revoke. Disable, update, and
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
public callback.

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
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Implements canonical transport and serialized slot coordination.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.tsx:1` - Mounts only an SDK slot and projects lifecycle visibility.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginConfirmationQueue.tsx:1` - Implements abort-aware FIFO confirmation UX.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated v0.6.7 lifecycle DTOs and signed release refs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Matches exact official identity and management revision.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Requires Plugin discovery in the built renderer.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.test.ts:1` - Covers canonical fetch and close-before-open ordering.
