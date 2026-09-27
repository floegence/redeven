---
type: UI Contract
title: Runtime settings
description: Navigate and edit runtime configuration through consistent, responsive settings surfaces while preserving API and permission ownership.
tags: [ui, runtime, settings, skills]
timestamp: 2026-09-27T16:18:00Z
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

The ten destinations are Config File, Connection, Runtime Status, Shell &
Workspace, Codespaces & Tooling, Logging, Permission Policy, Flower, Skills, and
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

Technical disclosures for connection, runtime status, providers, skills and
installation paths use at least 8px horizontal padding and 32px target height,
increasing to 44px for coarse pointers. The full padded summary activates the
native disclosure; neutral hover and visible keyboard focus identify its bounds
without promoting diagnostic content into a primary action.

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

## Skills operations

Skills load their catalog and source metadata on first entry once the runtime
connection is usable, through
`/_redeven_proxy/api/ai/skills`. Search and scope filtering affect only the visible
catalog. Each row retains enablement, effective/shadowed/degraded status, source,
path, browsing, reinstall, and delete actions. Catalog refresh and mutations are
serialized within the page so an older refresh cannot replace a mutation result.
Paths, source IDs and maintenance actions live in a closed details disclosure;
enablement, effective state and errors remain visible in the catalog row.

GitHub installation requires validation of the current form. Changing any input
invalidates that validation. Create and import failures keep the form open;
delete and overwrite reinstall require confirmation. A source-metadata refresh
failure is reported separately from an already successful mutation. The runtime
continues to enforce permissions and filesystem boundaries for every request.

Skill browsing uses the existing tree and file endpoints, renders file content
as text, and exposes encoding and truncation. Failed reads can retry the same
request. Closing the dialog or selecting another skill invalidates pending reads
so stale content cannot replace the new selection.

The runtime resolves browsing against the current catalog. A bundled
`system:<name>/SKILL.md` entry is a virtual identifier: its root lists the single
`SKILL.md` document and its preview reads the same embedded content used by the
skill manager. It must never be interpreted as a host filesystem path. Unknown
catalog entries and missing bundled children fail explicitly; relative path
validation, encoding, size limits, and truncation apply to both bundled and
filesystem skills. Local and GitHub-installed skills retain filesystem and
symlink containment checks. Browsing requires read permission, not administrator
permission, and does not install or materialize bundled files on disk.

# Boundaries

Read access cannot edit administrator fields. All writes use existing authenticated APIs, and failed operations preserve input with an actionable error. Runtime maintenance requires explicit user confirmation through its existing shared controller.

# Evidence

- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx` owns destinations,
  selection, and retained panels.
- `internal/envapp/ui_src/src/ui/pages/settings/SettingsPrimitives.tsx` and
  `internal/envapp/ui_src/src/ui/pages/runtime-settings-compact.css` adapt published Floe surfaces;
  `internal/envapp/ui_src/src/styles/redeven.css` owns semantic palette roles.
- `internal/envapp/ui_src/src/ui/pages/settings/EnvSettingsPageContext.tsx`
  delegates settings writes and runtime maintenance.
- `internal/envapp/ui_src/src/ui/pages/settings/sections/SkillsSection.tsx` and
  `internal/envapp/ui_src/src/ui/pages/settings/SkillFilesDialog.tsx` own skill UI
  requests; `internal/codeapp/appserver/server.go` owns the API boundary.
- `internal/ai/skill_manager_remote.go` resolves browse sources and enforces
  file boundaries; `internal/ai/skill_manager_browse_test.go` and
  `internal/codeapp/appserver/server_ai_skills_test.go` verify embedded previews,
  filesystem containment, and read permission.
- `internal/envapp/ui_src/src/ui/pages/RuntimeSettingsDesign.browser.test.tsx`
  checks page geometry, retained drafts, navigation, dialogs, and API adapters.
- `internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.test.tsx` and
  `internal/envapp/ui_src/src/ui/pages/settings/sections/SkillsSection.test.tsx`
  cover confirmation, target validation, failure, and read-only behavior.
- `internal/envapp/ui_src/src/styles/settingsThemeHierarchyVisual.browser.test.tsx`
  checks the settings hierarchy across the shipped theme palette.
