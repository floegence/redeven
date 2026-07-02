---
type: UI Contract
title: Plugin surfaces
description: Redeven places released ReDevPlugin sandbox surfaces into product chrome without owning the plugin iframe lifecycle.
tags: [ui, plugins, workbench, settings]
timestamp: 2026-07-02T00:00:00Z
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

Settings placement follows the existing grouped Settings model. The current
Settings navigation already groups Flower, Skills, and Codex under
`AI & Extensions`; a future Plugins section belongs in that product area unless
the product creates a more specific extension-management group. Plugin settings
UI may project host policy, installed plugin state, and adapter diagnostics, but
the settings/intent SDK and plugin-owned UI lifecycle remain ReDevPlugin
artifacts.

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

# Citations

[1] redeven:AGENTS.md:290 - Plugin UI platform code comes from released ReDevPlugin npm packages.
[2] redeven:AGENTS.md:316 - Redeven may place ReDevPlugin surfaces into Env App, Activity Bar, Workbench, Settings, Desktop, or CLI flows.
[3] redeven:AGENTS.md:452 - Redeven UI may frame host chrome but plugin documents load through ReDevPlugin sandbox bootstrap and bridge lifecycle.
[4] redeven:AGENTS.md:550 - A native Redeven component is not an official plugin surface unless it exercises the sandboxed plugin path.
[5] redeven:AGENTS.md:623 - Interactive UI controls must expose pointer cursor affordance while enabled.
[6] redeven:AGENTS.md:641 - Workbench wheel ownership is canvas-first and selected-widget guarded.
[7] redeven:AGENTS.md:653 - Workbench text selection and copy are first-class interaction contracts.
[8] redeven:internal/envapp/ui_src/src/ui/pages/settings/settingsStructure.ts:45 - Settings sections are declared in a single grouped navigation structure.
[9] redeven:internal/envapp/ui_src/src/ui/pages/settings/settingsStructure.ts:71 - Flower, Skills, and Codex currently live under `AI & Extensions`.
[10] redeven:okf/ui/workbench-interaction-contracts.md:11 - Workbench input ownership uses explicit marker contracts.
