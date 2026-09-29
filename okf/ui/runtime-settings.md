---
type: UI Contract
title: Runtime settings
description: Navigate and edit runtime configuration through consistent, responsive settings surfaces while preserving API and permission ownership.
tags: [ui, runtime, settings]
timestamp: 2026-09-27T17:29:30Z
---
# Summary

Env App owns the runtime settings destinations, localized copy, drafts, and API
adapters. Published Floe settings components own reusable layout, navigation,
section hierarchy, and responsive setting rows. Every destination stays usable
on a narrow viewport and preserves its draft and scroll position when revisited.
Configuration writes use the existing authenticated runtime APIs; readers can
inspect settings but cannot edit administrator fields. Failed operations retain
their input and show an actionable error. Runtime maintenance remains delegated
to the shared maintenance controller after explicit user confirmation.

# Contract

## Navigation and visual hierarchy

The nine destinations are Config File, Connection, Runtime Status, Shell &
Workspace, Codespaces & Tooling, Logging, Permission Policy, Flower, and
Debug Console. Desktop navigation groups and filters these destinations. Overview
contains Connection and Runtime Status; Runtime Environment contains Shell &
Workspace and Codespaces & Tooling; Diagnostics contains Config File, Logging,
and Debug Console. Narrow
viewports expose the same destinations through a section picker. Related links
connect the smaller configuration and diagnostic pages to their next actions. On narrow viewports the picker is in the page header and the desktop breadcrumb is removed, so the settings body has no empty mobile-navigation slot or repeated section title. The native picker remains a 44px touch target with 16px text.

Each page has one primary heading, a short description, and contextual actions.
Sections use secondary headings; continuous settings use shared rows and
dividers instead of repeating bordered cards. Status and connection facts use
the same row treatment, while long paths wrap, controls stay within their page, and dialog actions
remain reachable independently of the scrolling dialog body. Colors derive from
the current Floe theme and Redeven semantic surface roles, including dark and
high-contrast themes. Input focus follows the published border-only contract.

The visual selection uses the existing UI-first transaction. Committed sections
remain mounted through `UIFirstKeepAlivePanel`, preserving form values and scroll.
Opening runtime settings from Flower retains the existing return destination.
Generic geometry is consumed from released `floe-webapp` components rather than
copied into Redeven. The product adapter supplies palette roles, content, and
the approved product scale: a 228px navigation rail, an 860px page including
40px side padding, a 25px primary heading, 13px row labels, 12px supporting
text, and 14px grouped-list corners. The desktop page starts with 44px top
padding; narrow pages use 28px top and 20px side padding. Geometry lives with
the settings page so global and lazy-loaded styles cannot compete for ownership.

Row composition is part of this contract, not only outer geometry. Identity and
guidance stay left; values, permissions and actions share the right column.
Configuration paths wrap beside their icon-only full-value copy action. Related
destinations use continuous action rows. Diagnostic IDs, installation paths and
maintenance metadata start collapsed; actionable errors remain visible.

Secondary copy actions use the same product treatment in runtime and Desktop
settings: transparent at rest, muted 12px glyphs, and a neutral hover background.
They remain visible without hover, retain the published Button keyboard focus
indicator, and expose a localized accessible name. Icon-only targets are 28px
with 44px targets for coarse pointers. Success changes the glyph or reserved
label without moving the adjacent value. Primary copy steps in manual connection
setup keep their workflow emphasis; this treatment applies to auxiliary actions.

Technical disclosures for connection, runtime status, providers and
installation paths use at least 8px horizontal padding and 32px target height,
increasing to 44px for coarse pointers. The full padded summary activates the
native disclosure; neutral hover and visible keyboard focus identify its bounds
without promoting diagnostic content into a primary action.

## Settings controls and identity

Runtime, Desktop environment, Flower, terminal and managed-service settings share
one product field treatment: 34px minimum height, 8px corners, 12px text, a quiet
neutral fill and a subdued 1px border. Inputs, textareas and the published Select
trigger use the same palette; compound inputs retain one frame. Coarse pointers
use at least 44px and 16px text. Search fields reserve their icon spacing.
High-contrast themes retain strong boundaries. Published Floe still owns keyboard
operation, validation, menus and border-only focus; product styling never replaces
those behaviors. The adapter consumes released controls without local overrides
of dependency code or a parallel input implementation.

Identity rows use semantic directory and skill icons. Provider rows use the
shared provider brand catalog, including DeepSeek; monochrome brands inherit the
foreground so they remain visible in light and dark themes. Scalar input labels
do not need decorative identity icons.

## Configuration editing

Shell, filesystem, logging, port, and permission changes retain their existing
autosave and restart requirements. `PUT /_redeven_proxy/api/settings` accepts flat
request fields: response groups such as `runtime`, `logging`, and `codespaces`
must not be sent as request wrappers. Filesystem updates carry the complete
versioned `filesystem_scope`, preserving root kind, identity, and permissions.
Default ports are reset with zero values. Failed autosaves retain the draft and
stop retrying until the user edits it. Editing controls and autosave require
both a connected usable settings context and administrator permission.

Directory rows show their name and path opposite actual access and actions.
Adding or editing a custom directory uses a separate draft dialog; Cancel never
creates or saves a root. Enabling writes still requires explicit confirmation.
Permission rules use user/app tables with read, write and execute columns;
narrowing the environment ceiling clears and disables incompatible grants.

Connection status follows the live protocol state, never the presence of IDs.
Details remain read-only, with copy actions and the existing Desktop Connection
Center route. Debug Console remains a local interface preference.
Runtime restart and upgrade display a confirmation that identifies active work
and the upgrade version. The shared controller owns execution, authority routing,
progress, and recovery; settings do not create another maintenance lifecycle.

Codespaces shows the selected editor, actual source and update action first.
Compact version rows keep Use and Remove on the right; the selected version has
a selection marker without redundant disabled actions. Binary paths and Runtime
directories share one installation disclosure. Paired numeric port fields and an
explicit default-range control preserve the existing zero-value reset contract.

Runtime Flower settings use Models & providers, Permissions, and Health & storage
tabs. All three bodies retain their state. Blocked or degraded readiness exposes
a direct recovery action even when another tab is selected. Existing readiness,
storage, model discovery, secret handling, and permission contracts remain the
owners of those operations. The separate shared chat settings surface is defined
in [Flower setup and settings](flower-setup-and-settings.md).
The current model uses a standard setting row, providers disclose model details,
and default permissions use one vertical radio list with keyboard navigation.
Health, diagnostic and backup actions follow the same right-column arrangement;
expanding diagnostics or reviewing restore retains the existing permission and
confirmation boundaries.

## Flower extension placement

Skills and MCP belong to Flower. Open their shared management page from the
`Skills·MCP` entry below New chat in Flower's conversation rail. Runtime settings
retain model providers, permissions, health, and storage. The
[Flower extensions contract](flower-extensions.md) owns catalog operations,
browsing, and extension management interactions.

# Boundaries

Read access cannot edit administrator fields. All writes use existing authenticated APIs, and failed operations preserve input with an actionable error. Runtime maintenance requires explicit user confirmation through its existing shared controller.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx` owns destinations,
  selection, and retained panels.
- `internal/envapp/ui_src/src/ui/pages/settings/SettingsPrimitives.tsx` and
  `internal/envapp/ui_src/src/ui/pages/runtime-settings-compact.css` adapt published Floe surfaces;
  `internal/envapp/ui_src/src/styles/redeven.css` owns semantic palette roles.
- `internal/envapp/ui_src/src/styles/settings-controls.css` adapts released fields
  across product settings; `internal/flower_ui/src/settings/providerBrandIcons.ts`
  owns the shared brand definitions.
- `internal/envapp/ui_src/src/ui/pages/settings/EnvSettingsPageContext.tsx`
  delegates settings writes and runtime maintenance.
- `internal/envapp/ui_src/src/ui/pages/RuntimeSettingsDesign.browser.test.tsx`
  checks page geometry, retained drafts, navigation, dialogs, and API adapters.
- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.test.tsx`
  covers confirmation, target validation, failure, and read-only behavior.
- `internal/envapp/ui_src/src/styles/settingsThemeHierarchyVisual.browser.test.tsx`
  checks the settings hierarchy across the shipped theme palette.
