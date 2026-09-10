---
type: UI Contract
title: Plugin Center interaction
description: Browse and manage plugins in an Activity page or an input-isolated Workbench bottom drawer with retained navigation and responsive details.
tags: [ui, plugins, plugin-center, workbench, accessibility]
timestamp: 2026-09-11T00:00:00Z
---
# Summary

Redeven owns Plugin Center navigation and presentation; released Floe Webapp owns
Dialog positioning, Portal placement, presence, and modal input. Workbench opens
one retained bottom drawer outside its inert canvas. Activity uses the same
directory in a page. Search, filters, selection, and scroll survive reopening.
Failed actions remain actionable; closing management never cancels an admitted
Host Execution. Released ReDevPlugin remains the authority for lifecycle actions,
permissions, exact inventory identity, and SDK surface lifetime.

# Contract

## Management placement and input

Only Plugin Center explicitly selects global Dialog placement at the product
modal layer. Its content owner inherits that context, including nested install,
update, and uninstall dialogs. Recent Dock or widget interactions cannot mount
the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.
Other Workbench dialogs retain their local projection and input contracts.

The drawer is centered, 20px above the bottom, with 16px corners. Width is the
smaller of 1400px and viewport width minus 48px; narrow-screen margins are 12px.
Height is the smaller of 820px and 82dvh, capped below the top navigation. It uses
shared theme surfaces, a thin border, soft shadow, and a light theme scrim.
Position and opacity animate over 240ms entering and 180ms exiting; reduced
motion preserves behavior without waiting for decorative motion. There is no
dragging, resizing, or persisted drawer geometry.

Canvas input stays disabled throughout visible presence, including exit. Outside
clicks only dismiss management; they never reach the canvas. Wheel input scrolls
the constrained directory or details body without zooming the canvas. Tab and
Shift+Tab cycle within the active modal. Menus and nested confirmations own
Escape before the parent. Closing menus or confirmations restores their stable
trigger; a narrow detail consumes the next Escape, then the drawer closes.

Normal entry focuses search; an exact inventory request focuses that plugin's
detail heading. Every instance generates its own tab, panel, and heading IDs.
Mode changes or connection-recovery entry close the drawer and transient child
dialogs. The content remains alive and submitted installation is owned by
[installation progress](plugin-installation-progress.md). A successful Open
closes management and focuses the target after canvas input becomes available;
a failed Open preserves the directory and error feedback.

## Directory and responsive details

Local filters combine
source (official catalog or external), trust, and lifecycle without rebuilding
identity. Every filter trigger permanently names its dimension and current
value, exposes a dropdown affordance, and keeps one clear-all action visible
whenever search, category, source, trust, or lifecycle filtering is active.
The title, search, refresh, administrative menu, and close action form a compact primary
toolbar; tabs, categories, and filters form a second scroll-contained band
without page-level horizontal overflow. Discover, Installed, and Updates use
one responsive compact card directory with a 176px minimum and natural content height, 40px identity icons, at most two summary lines, and independent
primary, surface, overflow, and detail commands. Updates carry an explicit
information treatment and update command. Open uses a compact neutral action; install and enable remain emphasized. Empty or repeated summaries leave no reserved description block. Refresh status remains outside the
card grid, so a pending refresh cannot appear as a duplicate card. The inspector
orders identity and summary, primary actions, manifest-owned author description
and highlights, required and optional permissions, issue evidence, and collapsed
technical information. Its identity and primary-action region remains stable
while the author, permission, issue, and technical body scrolls independently;
long localized copy cannot push the current action out of view. Policy caps,
effective grants, revocation, and required-to-open semantics remain distinct.
Startup recovery is per installed plugin rather than a Plugin Center-wide
loading boundary. The shell, catalog, filters, and ready plugin actions remain
interactive while another plugin recovers. Each recovering card names its own
state; each failed card shows the safe reason and one explicit Retry action, and
only that failed plugin's Open controls are disabled. Repeated Retry input shares
the in-flight recovery operation and cannot create duplicate submissions.
The directory opens with no inspector selected. Only an explicit item selection
or Shell exact-key request opens detail; closing detail preserves the directory
tab, query, and filters, then restores the originating exact item when it is
visible or the search field when retained filters hide it. A committed external
install or update protects its exact instance selection from retained filters
until the user changes directory context or closes detail. A Shell request remains
bound to its requested item even when retained filters exclude it. External
installation is visible only to administrators as a lower-weight overflow action
and does not compete with primary discovery.


At a content width of at least 1100px, selected details occupy a 400px right
column and the directory remains interactive beside it. At narrower widths,
details replace the directory region and expose a labeled Back action. Details
are a region inside the current page or modal, not a second modal. Identity and
primary actions stay fixed while the detail body scrolls independently.

# Boundaries

Management presentation never creates a second lifecycle or permission authority.
[Plugin surfaces](plugin-surfaces.md) owns exact inventory and SDK placement;
[package review](plugin-package-review.md) owns admission and authorization copy.
Global placement applies only to this product modal and its confirmations, not
to ordinary Workbench widget dialogs or menus.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterDrawer.tsx:1` - Retains content within an explicit global placement context and consumes the released bottom-drawer Dialog.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Owns entry, presence-based canvas input, mode/recovery closure, and successful placement focus.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Owns exact selection, scoped keyboard behavior, distinct accessibility IDs, and responsive details.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterItems.tsx:1` - Projects compact cards from existing lifecycle actions.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterWorkbench.browser.test.tsx:1` - Exercises real Dock/menu entry, native inert hit testing, nested modality, geometry, scrolling, and retained state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Covers responsive geometry, localization, update review, motion, and Workbench continuity.
