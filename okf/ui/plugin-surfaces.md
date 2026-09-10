---
type: UI Contract
title: Plugin surfaces
description: Env App manages official and external plugins through an accessible Launcher, searchable category discovery, exact inventory identities, explicit review, SDK-owned surfaces, Activity windows and pinned pages, and Workbench widgets.
tags: [ui, plugins, activity, workbench, plugin-center]
timestamp: 2026-09-11T00:00:00Z
quality_exception: Cross-surface discovery, navigation, permissions, and SDK surface presentation contract; installation, package review, and saved layout continuity are separate concepts.
---
# Summary

Redeven owns plugin navigation, discovery, management presentation, and placement;
released ReDevPlugin owns package admission, surface authority, confirmations,
bridge sessions, and revocation. Open uses the current mode with independent SDK
slots in Activity and Workbench. Saved canvas placement survives runtime cleanup;
[plugin layout continuity](plugin-layout-continuity.md) owns recovery and removal.
Unknown outcomes require authoritative reconciliation, never wider teardown or
blind retry. Management retains search and selection while exposing actionable
failures and current permissions.

# Contract

## Discovery and exact inventory

The Activity Bar `Plugins` entry opens a Shell-root Launcher without changing
the current normal surface. On desktop it is the permanent first Activity Bar
entry, followed by built-in Activities, Flower, and then user-pinned plugins in
saved order. Desktop uses a centered modal with a search field,
responsive icon grid and stable scrolling body without a summary footer; mobile uses a
bottom sheet with the same controls and at least 44px touch targets. Search normalizes Unicode with
NFKC and locale-aware case folding, matches display name, canonical keywords,
and the locale's explicit alias key, and intersects with the selected category.
The category set is stable (`development`, `infrastructure`, `utilities`,
`data`, `collaboration`, `productivity`, `other`) and never inferred from
localized labels. Market categories `utilities` and `weather` project to the
product-owned `utilities` category. Category controls stay hidden below six
installed plugins and appear at six without changing category identity. Empty results provide a single
clear-filters action. A launchable plugin tile's primary action opens its
declared default surface directly; plugins that cannot launch fall back to
their exact management detail by `inventoryKey`.
Escape clears search before closing, focus is trapped and restored, background
content is inert, and arrow/Home/End navigation remains within the visible grid.
Each plugin is a semantic list item containing a native primary button. The
compact launcher header exposes one market icon action for Plugin Center;
plugin tiles do not render a visible overflow button. Right-click, Context Menu,
and Shift+F10 expose a compact icon-and-text menu with `Plugin information` and
exactly one mode-specific pin or unpin action, with arrow, Home/End, Enter,
Escape, outside dismissal, and focus restoration. `Plugin information` carries
the exact `inventoryKey` into Plugin Center and opens that item's inspector. The
menu reuses the file-browser context-menu sizing and the released
`SurfaceFloatingLayer`; global Activity and Launcher menus remain above plugin
windows and the Launcher, while Workbench requests project into the owning
surface rather than using a global z-index or viewport-fixed coordinates. In
Workbench placement, installed
tiles and pinned Dock items use the released Floe Webapp drag transaction. Over
the canvas it projects the standard `redeven.plugin` frame from its 1120 by 760
world-unit definition; pointer release commits the same resolved world center,
so zoom, pan, and edge auto-pan cannot move the created widget away from its
preview. A canvas drop creates one widget without recentering the viewport only
when that exact plugin instance and surface is absent. A repeated drop or pinned
Dock click activates, focuses, and centers the existing widget, so one exact
target cannot occupy two Workbench widgets; different targets may coexist. A
Dock drop only pins the inventory item. Cancellation or release outside
both targets performs no action. Workbench pins declare Floe Webapp's
`after-components` placement, so they follow the built-in component group and
Flower in saved order; the external drag placeholder uses the same placement.
Pin persistence is one renderer- and
environment-scoped v2 record with independent ordered `activityInventoryKeys`
and `workbenchInventoryKeys` lists. v1 Dock order migrates only into the
Workbench list. Duplicate operations are idempotent, malformed or future state
fails closed, and an unavailable plugin leaves a dormant record that reappears
when its current inventory target becomes launchable. Absent product mutation
APIs are not simulated. Click suppression after a drag belongs only to Floe's
shared drag transaction; the Launcher keeps no second suppression flag.

The Workbench Launcher is a Dock companion, not a page-level modal. It mounts
through `WorkbenchDockPopoverSurface` in the owning Workbench surface, delegates
projection and clamping to the shared floating layer, and inherits the Dock
background, border, radius, shadow, blur, and theme material. Its product-owned
content has no header or footer divider and omits the installed and attention
summary. Size, content layout, search, focus loop, and close behavior remain
product-owned. Activity placement keeps the existing Shell-root modal behavior,
including its header divider; both placements omit the installed and attention
summary footer.

[Plugin Center interaction](plugin-center-interaction.md) owns the shared directory,
retained Workbench drawer, responsive details, modal input, and management focus.

Plugin motion is progressive feedback rather than an interaction gate. The
Launcher establishes backdrop depth before its content settles, and its panel
uses reversible opacity and transform transitions rather than fixed keyframe
replays. The desktop Activity Launcher derives its transform origin and small
directional offset from the current Activity Bar trigger; the mobile sheet and
Workbench companion retain bottom-edge origins. Entry completes within 240ms,
content follows after a bounded 35ms delay, and exit completes within 150ms.
A rapid close or reopen reverses from the current visual pose without snapping,
while the closing surface stops accepting pointer input. Directory, detail,
review, confirmation, loading, error, and recovery states retain bounded
150–200ms entry feedback; repeated directory items use a bounded stagger, and
interactive controls transition only explicit color, border, shadow, opacity,
and transform properties. Press feedback begins immediately and never delays the
underlying command. `prefers-reduced-motion: reduce` removes entry animations,
transform feedback, disclosure motion, and nonessential transitions, and closes
the Launcher without a motion timer while preserving the same focus, selection,
loading, and recovery behavior.

The Shell owns inventory loading, one platform client, shared scope, placement
controllers, and the selected product inventory key. Every catalog or installed
item has a stable `inventoryKey`; Panel tiles, Center rows, detail selection, and
commands carry that exact key. Plugin id is not unique, and instance id alone is
not used to select catalog presentation. This keeps an official catalog entry
and multiple external instances with identical manifest ids independent.

Inventory lifetime follows the authenticated Host session, not the visibility
of the Launcher or Plugin Center. Once the protocol and local plugin session are
ready, the Shell prefetches one projection in the background. Closing or
reopening either surface neither cancels nor reloads it. A lifecycle mutation,
explicit retry, or session change refreshes through that same owner. During a
same-session refresh the last successful projection remains interactive, so the
Launcher never replaces existing tiles with a visible loading banner or an
empty-state flash. A refresh failure keeps that projection and exposes its error; it cannot count as authoritative reconciliation of a mutation. A first-load failure remains explicitly retryable. Disconnect or session
replacement aborts the old request and clears its projection boundary before a
new owner can publish results. This process-local projection is not durable
plugin state; Host catalog and `action_state` remain authoritative.

Official catalog presentation comes from the current latest-only market snapshot,
which the Host refreshes and atomically swaps without restarting the Desktop
and ultimately from the signed manifest. It requires exact publisher, plugin,
version, package, manifest, and entries identity. Historical content additionally
requires the fixed catalog instance and Host-verified official signature.
Official-looking ids never inherit catalog trust or update controls, and Redeven
does not carry plugin-specific author presentation.

Lifecycle commands carry the current management revision. Permission mutations
also carry policy revision and revoke epoch. Unknown mutation outcomes invalidate
affected surfaces and refresh inventory without blind retry. Plugin Center admits
one mutation at a time. Its presentation model evaluates trust and execution
approval first, then policy, updates, required access, runtime readiness, and
lifecycle. Open is available only for a ready launch target. Update and disable
are secondary actions; uninstall opens a dedicated keep-or-delete-data dialog.
Every dialog open resets to keep data, while delete data requires a separate
destructive confirmation before mutation submission. On narrow screens, list
selection enters a detail view, focuses its explicit back action, and restores
focus to the originating inventory row on return. On tablet and desktop,
the detail drawer overlays the directory without resizing or reflowing the card
grid; closing it restores focus to the originating row.

## Session recovery

After a direct-session handshake, the Shell requests the idempotent Host
`recoverEnabled` snapshot on the explicit authenticated plugin-session-ready
transition; it does not insert a stability timer. Plugin Center remains
interactive while enabled plugins recover and may present each Host-projected
result with an explicit Retry action. The Host owns recovery identity,
single-flight, timeout, package binding, and retry semantics. Env App stores no
failed-instance or catch-up owner and never turns recovery presentation into a
second open gate. Cards, details, launchers, and placement commands consume the
Host `action_state`; they do not derive `can_open` from trust, policy, grants, or
recovery flags.

## Installation and package review

[Official installation progress](plugin-installation-progress.md) owns durable
Execution observation and approved setup. [Plugin package review](plugin-package-review.md)
owns update and external-source inspection, confirmation, and result handling.
Both workflows preserve the placement contract and never turn a failed operation
into component deletion.

## Permissions and policy

Plugin Center joins installed records, active grants, Host permission
requirements, and security policy. Missing required access blocks only the
affected plugin open or capability call and presents a permission explanation.

Generic requirements come from the released Host projection of the active
version's verified capability contracts, not manifest claims. Only an environment
administrator may grant or revoke. An allowlist cap, denied method, active grant,
and effective permission remain separate. Generic permission controls and their
confirmation preserve the exact permission id in technical evidence and the
mutation payload. Stable capability namespaces use product-owned semantic copy:
`network.client` and other `network.*` permissions are presented as network
access even when their declared methods include write or delete effects. Method
effects never rename the capability being granted. A stale grant remains revocable when
policy blocks its use. Failure reloads inventory, grants, and policy and requires
a new confirmation.

## Activity windows and pinned pages

Each Activity window owns one fresh `PluginSurfaceSlot` and opens it only through
`openSurfaceInSlot`. The SDK Promise is the sandbox load, bridge handshake,
worker readiness, and first-commit boundary. Redeven creates no iframe,
bootstrap, asset session, or bridge.

Short openings keep the content area steady. Delayed SDK progress shows a
localized preparation, connection, access, startup, or content-loading status.
Closing has its own quiet placement-owned status layer. An opening or bridge
failure replaces the iframe area with a recovery panel; timeouts explain that
the plugin took too long and offer Retry. Collapsed technical details contain
the error and bounded SDK stage, elapsed time, and pending milestones. Copy
diagnostics includes only the stable error code and those allowlisted fields;
clipboard failure leaves selectable text and explicit feedback.

Retry first retires the failed slot, then creates and opens a fresh slot; it
never reuses the failed iframe, host, bridge, or surface instance. Unknown close
outcomes keep the first failure and explain that Retry must finish exact cleanup
before reopening. Pending cleanup disables duplicate retry input. Progress and
copy callbacks from an old slot cannot change its replacement.

The released SDK opens retained hidden, offscreen, and zero-size surfaces without
waiting for browser paint. Actual worker first commit remains the opening
boundary. Host mode, zoom, pan, and filtering keep healthy iframes mounted;
visibility still controls interaction and lifecycle hints, never authority.

The Shell owns the only Activity registry, exact-target deduplication, activation
stack, bounded z-order, and geometry persistence. Reopening activates the stable
window. Capacity eviction awaits the least-recently-active exact close; failure
preserves its recovery shell and rejects the new open. On mobile the same stable
DOM becomes full-screen; only the active window receives input and accessibility
exposure, while hidden windows retain DOM and released `hidden` lifecycle.

Closing during surface opening queues visibly until the exact close handler is
ready. Close first attempts the `hidden` lifecycle hint, awaits released
idempotent single-surface reconciliation, and disposes only after exact close
success. A `hidden` delivery failure does not override successful close and
local disposal. A close failure keeps the slot and window recovery shell so
retry repeats only the same exact close. If exact close succeeded but local
disposal failed, retry skips close and repeats only local disposal. Ending
the whole session is a separately confirmed destructive fallback. Local iframe
disposal is not revocation evidence, and uncertain close never affects siblings.

Desktop Activity pins use the manifest-verified current name and icon and a
stable component id derived from `inventoryKey`. Released
`FloeRegistryContributions` serializes dynamic registration and unregistration;
`ActivityAppsMain` mounts the full-page contribution on first activation and
keeps its DOM while other Activity pages are selected. View activation drives
the released `visible` and `hidden` lifecycle, and returning to the page does not
create another slot. The Activity Bar, top bar, and bottom bar remain visible.
Pinned Activity entries follow Flower and retain the saved pin order.
Mobile never receives dynamic plugin tab entries and continues to use the
Launcher and Activity window presentation.

Opening an already present Activity target activates its existing window or pinned page. Workbench uses a separate slot and never retires the Activity container. Unpin first closes the
mounted page; close failure retains both the shortcut and recovery presentation.
Successful unpin of the active page selects the latest built-in Activity page.
Restart restores shortcuts but always begins on a built-in page, so startup does
not automatically open third-party content.

## Workbench widgets and placement

[Plugin layout continuity](plugin-layout-continuity.md) owns saved binding,
atomic placement, exact-instance removal, retry, conflict, and recovery behavior.
A widget preserves its identity and geometry while its SDK surface is replaced.
Its source/port-bound interaction observations drive the existing local wheel,
selection, action, activation, focus, and floating-layer policy. Status overlays
may isolate unavailable content but must not forward events, guess plugin focus,
or establish another bridge. Dock clicks and world-coordinate drops create or
focus the standard widget. Unpinning removes only the shortcut.

## Confirmation and teardown

Surface capability confirmations use one abort-aware FIFO product dialog. The
trusted plan summary, plugin display name, action, target, and impact lead the
decision; method, hashes, tokens, and technical identities are folded into
details. Redeven does not infer risk from manifests or method names. Cancel owns
initial focus, each request is decided independently, and hidden, retired, or
revoked surfaces cannot approve queued work.

Explicit window/widget removal, external pre-update cleanup, and orderly Shell disposal use
exact-slot close. Disable, update, uninstall, permission/policy, and owner-scope
mutations rely on the released Host revoke followed by SDK scope invalidation or
disposal for committed and unknown outcomes; Redeven does not close an already
disposed slot. Session teardown uses the released session-scope revoke and waits
for the four-hash drain. Local disposal alone is never revocation evidence.
Browser reads retain same-origin Origin, CSRF, closed route action, and query-
effect authorization; Redeven adds no alternate endpoint or relaxed guard.

A user-initiated Surface file export stays inside the current placement and
uses the released bridge's bounded filename, media-type, byte, and action-window
validation. Redeven starts one browser download with the plugin-provided name,
then removes the transient link and revokes its object URL. Retired Surfaces
cannot start a download, and exported bytes are neither uploaded nor retained by
the Shell.

# Boundaries

Manifest surface kinds remain `view|command|background` with semantic roles.
Activity, Workbench, window, widget, inventory, navigation, settings, and layout
are Redeven placement concepts and never manifest fields.

Browser state is a projection, not registry authority. It does not verify
packages or releases, mint tokens, serve assets, grant permissions implicitly,
or call business adapters directly.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1` - Owns inventory, client lifetime, lifecycle commands, and cross-placement serialization.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPanel.tsx:1` - Carries exact inventory keys into launch, drag, and mode-specific pin menus.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPinContextMenu.tsx:1` - Owns accessible pin-menu keyboard, outside-dismissal, focus restoration, and surface-aware projection.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginDockPins.ts:1` - Owns v1-to-v2 migration and independent ordered Activity and Workbench pin lists.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Selects exact inventory items and owns install and update-review entry state.
- `redeven:internal/envapp/ui_src/src/ui/plugins/officialPluginCatalog.ts:1` - Projects verified market releases and manifest-owned presentation without plugin-specific author copy.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterItems.tsx:1` - Presents the compact Discover, Installed, and Updates card directory without owning selection or mutations.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Consumes Host `action_state`, RecoverySnapshot, Execution, and Event DTOs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/plugin-motion.css:1` - Defines the scoped subtle entrance and disclosure motion with a reduced-motion override.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Verifies responsive plugin geometry, real motion timing, and reduced-motion operability.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Isolates official and external identity, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfaceWindow.tsx:1` - Owns Activity floating chrome, mobile modality, focus, and close.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx:1` - Projects a pinned surface into Activity KeepAlive activation and visibility lifecycle.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Opens and retires only released SDK slots.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Owns persisted plugin widget open, replacement, removal, and cleanup.
- `redeven:internal/workbenchlayout/service_test.go:1080` - Covers persisted `redeven.plugin` widget state.
