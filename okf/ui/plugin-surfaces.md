---
type: UI Contract
title: Plugin surfaces
description: Redeven places official ReDevPlugin sandbox surfaces into Env App chrome without making Plugin Center a Settings page or overlay.
tags: [ui, plugins, workbench, plugin-center]
timestamp: 2026-07-16T00:00:00Z
---
# Summary

Plugin surfaces are ReDevPlugin sandbox documents placed inside Redeven product
chrome. Redeven decides discovery, placement, and product navigation, while
ReDevPlugin remains responsible for plugin identity, lifecycle, permissions,
confirmation, asset tickets, bridge tokens, RPC, streams, leases, audit, and
registry state.

# Contract

## Mechanism

Env App source contains a two-level official plugin entry, but product discovery
is development-only until the feature is ready for users. Vite serve enables the
entry automatically. Production-style builds enable it only when the owning
development launcher sets `REDEVEN_ENVAPP_ENABLE_PLUGIN_UI=1`; ordinary builds,
CI builds, and releases fail closed. A disabled build does not add the Activity
Bar `Plugins` item, register the internal Plugin Center or Plugin Surface
Activities, mount the panel, or start the plugin inventory resource.

When enabled, the Activity Bar `Plugins` item opens an app-grid panel without
changing the current normal Activity or Workbench surface. The first panel tile
is always `Plugin Center`. Enabled official plugins with a default launch target
open a sandbox plugin surface; unavailable, disabled, attention-needed, or
not-installed plugins route to Plugin Center details instead of pretending that
an iframe opened.

Plugin Center is a dedicated Env App management Activity, not Runtime Settings,
not a modal, and not a floating overlay. Opening it activates the internal
`plugin-center` Activity id and renders `PluginCenterView` in the Floe shell
main slot. Closing it returns to the last normal Activity surface, with
`terminal` as the default return target. Runtime Settings remains free of a
plugins section.

Official discovery is limited to the bundled Redeven official catalog seed.
The current seed contains `com.redeven.official.containers`. Plugin Center
merges that official catalog item with matching installed ReDevPlugin records
by `plugin_id`, excludes non-official installed records from this management
surface, and treats non-runnable trust states as needs-attention even when the
plugin id is official. First-release UX deliberately omits third-party
marketplace, developer mode, URL install, file install, unsigned local install,
ratings, comments, and remote search.

Official install and update use a bundled official package. Env App embeds the
Containers `.redevplugin` package as `officialPluginPackages.ts`; the UI sends
`package_base64` with `trust_state: "bundled"` to
`/_redeven_proxy/api/plugins/install` or `/_redeven_proxy/api/plugins/update`.
The UI does not download package URLs, verify signatures, parse manifests, or
write registry state. It delegates package validation, staging, trust-state
assignment, lifecycle mutation, retained data, and audit to the mounted
ReDevPlugin handler.

Enabled official plugin surfaces open through the released ReDevPlugin surface
open endpoint under `/_redeven_proxy/api/plugins/surfaces/open`. Env App then
renders the internal `plugin-surface` Activity using `PluginSurfaceFrame`, a
thin Redeven placement wrapper over the published
`@floegence/redevplugin-ui@0.1.5` `PluginSurfaceHost`. The frame requests
asset bootstrap from the plugin sandbox origin under
`/_redeven_plugin/bootstrap`, loads the iframe document from
`/_redeven_plugin/assets/{asset_session_id}/ui/index.html`, and adapts SDK
management calls from `/_redevplugin/api/plugins*` to
`/_redeven_proxy/api/plugins*`. The published SDK remains responsible for
exact-origin bridge filtering, bridge handshake validation, bridge-token
requests, RPC forwarding, confirmation handling, and lifecycle disposal.

`PluginSurfaceFrame` must stay narrow and product-placement oriented. It may
connect released ReDevPlugin routes to Env App chrome, choose the correct
regional or local loopback plugin sandbox origin, and project SDK errors into
the Activity frame. It must not grow into a copied SDK, generated client,
registry, manifest parser, storage broker, stream broker, or runtime platform.

Workbench placement remains shell ownership. If a future plugin surface is
placed in Workbench, the wrapper must preserve Workbench wheel, text selection,
copy, action-control, and activation contracts through the existing exported
interaction markers. A native Redeven component that does not exercise the
ReDevPlugin sandbox bootstrap and bridge lifecycle is a Redeven feature, not an
official plugin surface.

# Boundaries

Redeven UI state is a projection and command surface, not a plugin registry or
lifecycle source of truth. Install, enable, open, disable, uninstall, update,
diagnostics, export/import, and data-retention actions must call mounted
ReDevPlugin lifecycle APIs or released generated clients. The UI must not
compute CSRF tokens; AppServer and the ReDevPlugin integration wrapper attach
authoritative session headers before delegating management requests.

The build-time UI gate controls product discovery, not platform authorization.
Released backend integration, route isolation, runtime supervision, and business
adapters remain mounted and governed by ReDevPlugin policy while the production
Env App omits every user entry. The gate is not a runtime setting, URL option,
local-storage preference, or permission override.

Plugin assets and plugin RPC must not be smuggled through Env App dist,
codespace injection, port forwarding, direct Local UI session artifacts,
Gateway credentials, runtime-control tokens, or Flower grants. Plugin sandbox
documents load only through the plugin sandbox route family, and management
actions are Env App management routes only after Env App origin and Local UI
access gates have passed.

Official Containers is a sandboxed plugin surface over the Redeven
`container_resources` business capability. Containers are not a plugin runtime
mechanism and must not be used to execute third-party plugin backends.

# Evidence

- `redeven:AGENTS.md:256` - Redeven consumes ReDevPlugin through published artifacts only.
- `redeven:internal/envapp/ui_src/vite.config.ts:1` - Env App resolves the development-only Plugin UI build constant.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:858` - Env App gates inventory loading, entries, and Activity registration with the build constant.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Plugin Center renders the dedicated official management Activity view.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Plugin lifecycle wrappers call the Redeven proxy plugin namespace.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginPackages.ts:1` - Redeven embeds the bundled official Containers package for lifecycle install/update.
- `redeven:internal/envapp/ui_src/package.json:25` - Env App consumes the published ReDevPlugin UI package for PluginSurfaceHost.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceFrame.tsx:1` - The plugin surface frame bridges Env App placement to the published surface host.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/settingsStructure.ts:45` - Runtime Settings sections do not include Plugin Center.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs:1` - Built renderer smoke tests require Plugin UI to be hidden by default and can verify explicit development visibility.
