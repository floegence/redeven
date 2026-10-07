---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v3.0.33 and adds authenticated host modules, market-backed official releases, external-source policy, localized plugin presentation, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
---
# Summary

Redeven integrates ReDevPlugin `v3.0.33` through one Go Host, one canonical HTTP
namespace, one Env App `PluginPlatformClient`, one shared surface scope, and the
released ProcessManager over a verified Redeven-built Linux or Darwin runtime. Redeven
adds authenticated session mapping, public-source admission policy, product
placement, and business adapters; ReDevPlugin retains package, state, protocol,
trust, and runtime ownership. Activity supports Shell-root multi-window placement
and Workbench supports standard projected plugin widgets. Unproven owner,
package, capability, runtime, or surface identity fails closed.

# Contract

## Host construction and routes

`internal/redevpluginintegration` passes one explicit product-selected state root
to ReDevPlugin and constructs the Host with core, official release,
runtime, connectivity, secret, capability, and external-package modules. The
external module uses the bounded public HTTPS fetcher, GitHub Release resolver,
and package signature assessor. Inspections are process-local, opaque, and
TTL-bounded; no Redeven or ReDevPlugin stage/receipt/query database is opened.

AppServer mounts the released handler at `/_redevplugin/api/plugins`. It proves
an Env-trusted route, binds the exact trusted origin in server-only context, and
supplies the authenticated channel id. It does not flatten the wire contract,
translate to a second namespace, or serve a parallel package or bootstrap path.
The same session adapter backs direct Host and mounted HTTP authorization.

Persistent resources follow released `user` or `environment` scopes. Short-lived
surfaces, Executions, Events, handles, confirmations, and tokens bind the full
active owner-session, owner-user, owner-environment, and channel audience.
Session close uses the released durable four-hash coordinator and authentication
state is removed only after exact drain acknowledgement.

## Session authority and teardown

Each authenticated channel receives one process-local generation. Creation is
bound to the exact runtime instance that owns the already-held `agent.lock`; the
Host rejects caller assertions, a second lock, or a generation from another
process. Redeven's registry stores only plugin credential hashes, admits requests
through one reference-counted lease, and moves a generation through
`active -> retired -> terminal` without replacing an active channel in place.

Local UI plugin credentials additionally bind a server-generated access-session
id. The id remains internal and follows one resume lineage; the raw credential is
kept only in Env App memory. Logout, active expiry, direct transport EOF, and
server shutdown stop mint and request admission, remove pending artifacts, close
the exact WebSocket set, and retire only generations owned by that access session.
No-password mode scopes the access session to one direct connection.

For direct local transport, the Env App stages each credential against the exact
channel id and client generation returned by the connect artifact. A successful
Flowersec handshake starts one abortable Local UI readiness wait; it does not
publish the credential. The Agent marks that exact binding ready only after
ReDevPlugin session activation succeeds. The matching readiness response then
promotes the staged credential and starts inventory loading, recovery, and
Execution observation. Reconnect or replacement cancels the old wait, and a late
response cannot publish an older credential. Initializing and closed bindings
cannot reach the plugin platform route.

The released client preserves the HTTP status for rejected non-JSON responses;
only a successful response with malformed JSON is reported as an invalid JSON
contract. Redeven consumes that structured transport fact and does not infer a
status by parsing error text.

The Host owns durable session-scope teardown identity, phase, continuation,
terminal claim, migration, and reconciliation in its control database. Redeven's
`PluginSessionGeneration` is transient connection identity only; it cannot become
a second durable lifecycle owner. Shutdown closes Local UI admission and hijacked
transports before canceling Agent sessions, waits for request leases and session
handlers, and then invokes the released idempotent Host teardown path.

## Delegated package lifecycle

Released package inspection, installation, source policy, and runtime readiness are owned by [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

## Runtime boundary

The runtime module binds the canonical sibling executable, target, ReDevPlugin
`v3.0.33`, runtime-internal IPC and WASM ABI contracts, exact product-build descriptor, lease
replay storage, and released limits. Linux and Darwin runtime bytes are built
with Rust 1.88.0 from the attested release manifest and travel with SBOM,
provenance, notices, and signature evidence. Linux admission requires the
released static-PIE shape; Darwin admission requires the released native Mach-O
target, and release bytes are Developer ID signed before the product digest and
Sigstore evidence are written. The expected binary digest comes from the product
release marker; field binary bytes are never hashed and accepted as their own
trust anchor. Missing, non-canonical, wrong-target, unsigned, or wrong-hash
runtime evidence blocks startup.

Native Containers is intentionally outside the plugin runtime and does not
register a capability adapter. Its Local API, permissions, operation lifecycle,
and product surfaces are owned by
[Native container resources](container-resources-capability.md).

## Env App inventory and recovery

Authenticated inventory, installation observation, permission finalization, and reconnect recovery are owned by [Plugin surface recovery](redevplugin-surface-recovery.md).

## Placement

Each Activity target owns a fresh SDK slot inside one stable Shell-root floating
window. Multiple windows may remain mounted; desktop owns move, resize, stacking,
and geometry, while mobile presents only the active full-screen window to input
and accessibility. Responsive chrome never remounts or adopts the iframe.

Workbench persists plugin targets in standard `redeven.plugin` widgets. The
released source/port-bound interaction callback drives only Redeven's projected
wheel, text-selection, action, activation, focus, and floating-layer markers.
It does not become an authorization input or a second bridge.

Workbench plugin drag placement consumes Floe Webapp's released canvas
placement result directly. Floe owns the standard-size preview, zoom and pan
projection, edge auto-pan, final pointer snapshot, and world-coordinate
resolution. Redeven owns only the target-to-widget binding. The first placement
for an exact plugin instance and surface opens one `redeven.plugin` widget at
that world center without a second client-coordinate conversion or viewport-
centering step. A later drag or pinned-Dock activation reuses, activates, and
centers that same widget instead of creating a duplicate. Different exact
plugin targets may coexist. There is no plugin-specific Ghost or fallback drag
state.

Opening the same placement reactivates it. Moving between Activity and Workbench,
replacing a Workbench revision, or deleting a widget globally serializes the
transition and awaits exact old-slot close before persisting or opening the new
placement. The new target always receives a fresh slot lease and iframe. A lost
close response is reconciled by the released exact-surface contract; local
disposal alone is not revocation evidence.

# Boundaries

Canonical ownership is defined by [ReDevPlugin host integration boundary](redevplugin-boundary.md).
This concept owns only Redeven's concrete `v3.0.33` assembly.

Manifest surfaces remain `view|command|background` with semantic roles. Activity,
Workbench, window, widget, inventory key, navigation, settings, and product layout
never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.test.tsx:1` - Exercises product install review and permission-attention presentation.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:300` - Registers the standard projected plugin widget.
