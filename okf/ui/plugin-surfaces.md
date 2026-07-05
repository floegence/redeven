---
type: UI Contract
title: Plugin surfaces
description: Redeven places released ReDevPlugin sandbox surfaces into product chrome without owning the plugin iframe lifecycle.
tags: [ui, plugins, workbench, plugin-center]
timestamp: 2026-07-05T00:00:00Z
---

Plugin surfaces are ReDevPlugin sandbox documents placed inside Redeven product
chrome. Redeven may decide where a plugin appears, how the user discovers it,
and how plugin lifecycle actions are exposed, but the plugin document itself
must still come from released ReDevPlugin surface hosting, asset-ticket/session
validation, bridge lifecycle, and exact-origin messaging.

# Mechanism

The front-end platform implementation arrives as released ReDevPlugin npm
packages: surface host, bridge SDK, generated clients, settings and intent
helpers, and sandbox-safe UI utilities. Redeven UI code may mount those
packages into Env App, Activity Bar, Workbench, Settings, Desktop, or CLI flows
and may wrap them with Redeven navigation, product copy, diagnostics, and
empty/error states.

Workbench placement is shell ownership, not platform ownership. A plugin iframe
or plugin-surface widget must preserve Workbench input contracts for wheel,
text selection, copy, action controls, and widget activation. If the plugin
surface needs local scrolling or text selection inside a Workbench widget, the
Redeven wrapper must use the existing exported Workbench interaction markers
rather than loosening canvas routing. If a native Redeven component does not
exercise the ReDevPlugin sandbox bootstrap and bridge lifecycle, it is a
Redeven feature, not an official plugin surface.

Env App now exposes a two-level official plugin entry. The Activity Bar has a
`Plugins` trigger that opens a lightweight app-grid panel without changing the
current Activity or Workbench surface. The first panel tile is always
`Plugin Center`. Unavailable, disabled, attention-needed, and currently
surface-host-unavailable plugins route the user to Plugin Center instead of
pretending a sandbox surface opened. The panel is Redeven chrome only: it does
not parse manifests, install packages, mint tickets, or load plugin assets.

Plugin Center is a dedicated Env App management view, not a Runtime Settings
section. It opens from the first `Plugin Center` tile in the app-grid panel or
from plugin detail fallbacks, and it does not persistently switch the current
Activity or Workbench surface. The view owns product chrome for search,
Discover, Installed, Updates, list selection, and a details inspector while
projecting the Redeven official catalog seed and matching installed ReDevPlugin
records. First-release discovery is official-only and includes the Containers
plugin entry; installed records outside the official catalog are excluded from
this official management surface. The UI deliberately omits third-party
marketplace, developer mode, URL install, file install, and unsigned local
package entries. Plugin Center may project host policy, official installed
plugin state, lifecycle command status, and adapter diagnostics, but the
settings/intent SDK and plugin-owned UI lifecycle remain ReDevPlugin artifacts.
Official catalog membership is not enough to make an installed record runnable:
Plugin Center treats ReDevPlugin trust states other than `bundled`, `verified`,
and `unsigned_local` as attention-needed, with no Open or Enable action. Enabled
plugins with older official versions show Update without a misleading Enable
action.

# Boundaries

Redeven must not copy ReDevPlugin bridge SDK files, generated clients, sandbox
bootstrap code, asset-serving contracts, or host-neutral UI helpers into its
source tree. It must not place plugin assets directly under Env App routes,
load plugin UI outside the sandboxed ReDevPlugin bootstrap, or mint its own
asset tickets from UI code.

Redeven UI state is a projection and command surface, not a plugin registry or
lifecycle source of truth. Install, enable, open, disable, uninstall, update,
diagnostics, export/import, and data-retention actions must call released
ReDevPlugin lifecycle APIs or generated clients. User-facing controls remain
Redeven product UX, so interactive controls must expose pointer affordance while
enabled and disabled controls must not pretend to be clickable.
Lifecycle command calls are sent only through the Redeven plugin proxy
namespace. The UI does not compute ReDevPlugin CSRF tokens; AppServer and the
ReDevPlugin integration wrapper bind the authoritative session headers before
delegating management requests to the released handler.

The current released ReDevPlugin HTTP API consumed by Redeven exposes installed
plugin catalog, enable, disable, uninstall, update, and surface-open routes under
`/_redevplugin/api/plugins*`, which Redeven reaches through
`/_redeven_proxy/api/plugins*`. It does not yet expose a host-owned official
distribution install endpoint that downloads a package URL, verifies checksum
and signature, and installs through lifecycle. Therefore the current Plugin
Center disables official package installation when the catalog item requires
that host distribution install API; the UI must not compensate by downloading
or validating packages in the browser.

The current public npm registry does not expose a released
`@floegence/redevplugin-ui` surface-host package for Redeven to consume. Until
that package is released and consumed through `package.json`, Plugin Center keeps
surface Open disabled and the Activity Bar panel routes plugin tiles to Plugin
Center. Redeven must not hand-write the iframe bootstrap or bridge host as a
local substitute for the missing released package.

# Citations

[1] redeven:AGENTS.md:290 - Plugin UI platform code comes from released ReDevPlugin npm packages.
[2] redeven:AGENTS.md:316 - Redeven may place ReDevPlugin surfaces into Env App, Activity Bar, Workbench, Settings, Desktop, or CLI flows.
[3] redeven:AGENTS.md:452 - Redeven UI may frame host chrome but plugin documents load through ReDevPlugin sandbox bootstrap and bridge lifecycle.
[4] redeven:AGENTS.md:550 - A native Redeven component is not an official plugin surface unless it exercises the sandboxed plugin path.
[5] redeven:AGENTS.md:623 - Interactive UI controls must expose pointer cursor affordance while enabled.
[6] redeven:AGENTS.md:641 - Workbench wheel ownership is canvas-first and selected-widget guarded.
[7] redeven:AGENTS.md:653 - Workbench text selection and copy are first-class interaction contracts.
[8] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2300 - The Activity Bar defines Plugins as a trigger with a custom click handler.
[9] redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3111 - EnvAppShell renders PluginCenterView as a dedicated overlay rather than Settings content.
[10] redeven:internal/envapp/ui_src/src/ui/pages/settings/settingsStructure.ts:45 - Runtime Settings sections are declared without a plugins section.
[11] redeven:okf/ui/workbench-interaction-contracts.md:11 - Workbench input ownership uses explicit marker contracts.
[12] redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx:12 - The plugin panel is a controlled Redeven UI component over projected plugin inventory.
[13] redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:27 - Plugin Center renders official plugin management views from inventory projection.
[14] redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:9 - Env App plugin lifecycle calls use the Redeven proxy plugin namespace.
[15] redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts:3 - Redeven bundles the first official catalog seed entry for Containers.
